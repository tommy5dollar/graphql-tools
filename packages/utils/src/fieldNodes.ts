import { FieldNode, Kind, FragmentDefinitionNode, SelectionSetNode, GraphQLError } from 'graphql';
import { relocatedError } from './errors';

export function renameFieldNode(fieldNode: FieldNode, name: string): FieldNode {
  return {
    ...fieldNode,
    alias: {
      kind: Kind.NAME,
      value: fieldNode.alias != null ? fieldNode.alias.value : fieldNode.name.value,
    },
    name: {
      kind: Kind.NAME,
      value: name,
    },
  };
}

export function preAliasFieldNode(fieldNode: FieldNode, str: string): FieldNode {
  return {
    ...fieldNode,
    alias: {
      kind: Kind.NAME,
      value: `${str}${fieldNode.alias != null ? fieldNode.alias.value : fieldNode.name.value}`,
    },
  };
}

export function wrapFieldNode(fieldNode: FieldNode, path: Array<string>): FieldNode {
  let newFieldNode = fieldNode;
  path.forEach(fieldName => {
    newFieldNode = {
      kind: Kind.FIELD,
      name: {
        kind: Kind.NAME,
        value: fieldName,
      },
      selectionSet: {
        kind: Kind.SELECTION_SET,
        selections: [fieldNode],
      },
    };
  });

  return newFieldNode;
}

function collectFields(
  selectionSet: SelectionSetNode | undefined,
  fragments: Record<string, FragmentDefinitionNode>,
  fields: Array<FieldNode> = [],
  visitedFragmentNames = {}
): Array<FieldNode> {
  if (selectionSet != null) {
    selectionSet.selections.forEach(selection => {
      switch (selection.kind) {
        case Kind.FIELD:
          fields.push(selection);
          break;
        case Kind.INLINE_FRAGMENT:
          collectFields(selection.selectionSet, fragments, fields, visitedFragmentNames);
          break;
        case Kind.FRAGMENT_SPREAD: {
          const fragmentName = selection.name.value;
          if (!visitedFragmentNames[fragmentName]) {
            visitedFragmentNames[fragmentName] = true;
            collectFields(fragments[fragmentName].selectionSet, fragments, fields, visitedFragmentNames);
          }
          break;
        }
        default:
          // unreachable
          break;
      }
    });
  }

  return fields;
}

export function hoistFieldNodes({
  fieldNode,
  fieldNames,
  path = [],
  delimeter = '__gqltf__',
  fragments,
}: {
  fieldNode: FieldNode;
  fieldNames?: Array<string>;
  path?: Array<string>;
  delimeter?: string;
  fragments: Record<string, FragmentDefinitionNode>;
}): Array<FieldNode> {
  const alias = fieldNode.alias != null ? fieldNode.alias.value : fieldNode.name.value;

  let newFieldNodes: Array<FieldNode> = [];

  if (path.length) {
    const remainingPathSegments = path.slice();
    const initialPathSegment = remainingPathSegments.shift();

    collectFields(fieldNode.selectionSet, fragments).forEach((possibleFieldNode: FieldNode) => {
      if (possibleFieldNode.name.value === initialPathSegment) {
        newFieldNodes = newFieldNodes.concat(
          hoistFieldNodes({
            fieldNode: preAliasFieldNode(possibleFieldNode, `${alias}${delimeter}`),
            fieldNames,
            path: remainingPathSegments,
            delimeter,
            fragments,
          })
        );
      }
    });
  } else {
    collectFields(fieldNode.selectionSet, fragments).forEach((possibleFieldNode: FieldNode) => {
      if (!fieldNames || fieldNames.includes(possibleFieldNode.name.value)) {
        newFieldNodes.push(preAliasFieldNode(possibleFieldNode, `${alias}${delimeter}`));
      }
    });
  }

  return newFieldNodes;
}

export function dehoistValue(originalValue: any, delimiter = '__gqltf__'): any {
  if (originalValue == null) {
    return originalValue;
  }

  const newValue = Object.create(null);

  Object.keys(originalValue).forEach(alias => {
    let obj = newValue;

    const fieldNames = alias.split(delimiter);
    const fieldName = fieldNames.pop();
    fieldNames.forEach(key => {
      obj = obj[key] = obj[key] || Object.create(null);
    });
    obj[fieldName] = originalValue[alias];
  });

  return newValue;
}

export function dehoistErrors(errors: ReadonlyArray<GraphQLError>, delimiter = '__gqltf__'): Array<GraphQLError> {
  if (errors === undefined) {
    return undefined;
  }

  return errors.map(error => {
    const path = error.path;
    if (path == null) {
      return error;
    }

    let newPath: Array<string | number> = [];
    path.forEach(pathSegment => {
      if (typeof pathSegment === 'string') {
        newPath = newPath.concat(pathSegment.split(delimiter));
      } else {
        newPath.push(pathSegment);
      }
    });
    return relocatedError(error, newPath);
  });
}

export function unwrapValue(originalValue: any, path: Array<string>): any {
  let newValue = originalValue;

  const pathLength = path.length;
  for (let i = 0; i < pathLength; i++) {
    const responseKey = path[i];
    const object = newValue[responseKey];
    if (object == null) {
      break;
    }
    newValue = object;
  }

  delete originalValue[path[0]];
  Object.assign(originalValue, newValue);

  return originalValue;
}
