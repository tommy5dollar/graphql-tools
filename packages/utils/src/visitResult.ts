import {
  GraphQLSchema,
  getOperationRootType,
  getOperationAST,
  Kind,
  GraphQLObjectType,
  FieldNode,
  GraphQLOutputType,
  isListType,
  getNullableType,
  isAbstractType,
  isObjectType,
  OperationDefinitionNode,
  GraphQLError,
} from 'graphql';

import { ExecutionResult } from '@graphql-tools/utils';

import { Request, GraphQLExecutionContext } from './Interfaces';
import { collectFields } from './collectFields';

export type ValueVisitor = (value: any) => any;

export type ObjectValueVisitor = {
  __enter?: ValueVisitor;
  __leave?: ValueVisitor;
} & Record<string, ValueVisitor>;

export type ResultVisitorMap = Record<string, ValueVisitor | ObjectValueVisitor>;

export type ErrorVisitor = (error: GraphQLError, pathIndex: number) => GraphQLError;

export type ErrorVisitorMap = Record<string, Record<string, ErrorVisitor>>;

interface SegmentInfo {
  type: GraphQLObjectType;
  fieldName: string;
  pathIndex: number;
}

interface ErrorInfo {
  segmentInfoMap: Map<GraphQLError, Array<SegmentInfo>>;
  unpathedErrors: Array<GraphQLError>;
}

interface SortedErrors {
  errorMap: Record<string, Array<GraphQLError>>;
  unpathedErrors: Array<GraphQLError>;
}

export function visitData(data: any, enter?: ValueVisitor, leave?: ValueVisitor): any {
  if (Array.isArray(data)) {
    return data.map(value => visitData(value, enter, leave));
  } else if (typeof data === 'object') {
    const newData = enter != null ? enter(data) : data;

    if (newData != null) {
      Object.keys(newData).forEach(key => {
        const value = newData[key];
        newData[key] = visitData(value, enter, leave);
      });
    }

    return leave != null ? leave(newData) : newData;
  }

  return data;
}

export function visitErrors(
  errors: ReadonlyArray<GraphQLError>,
  visitor: (error: GraphQLError) => GraphQLError
): Array<GraphQLError> {
  return errors.map(error => visitor(error));
}
export function visitResult(
  result: ExecutionResult,
  request: Request,
  schema: GraphQLSchema,
  resultVisitorMap?: ResultVisitorMap,
  errorVisitorMap?: ErrorVisitorMap
): any {
  const partialExecutionContext = {
    schema,
    fragments: request.document.definitions.reduce((acc, def) => {
      if (def.kind === Kind.FRAGMENT_DEFINITION) {
        acc[def.name.value] = def;
      }
      return acc;
    }, {}),
    variableValues: request.variables,
  } as GraphQLExecutionContext;

  const errorInfo: ErrorInfo = {
    segmentInfoMap: new Map<GraphQLError, Array<SegmentInfo>>(),
    unpathedErrors: [],
  };

  const data = result.data;
  const errors = result.errors;
  const visitingErrors = errors != null && errorVisitorMap != null;

  if (data != null) {
    result.data = visitRoot(
      data,
      getOperationAST(request.document, undefined),
      partialExecutionContext,
      resultVisitorMap,
      visitingErrors ? errors : undefined,
      errorInfo
    );
  }

  if (visitingErrors) {
    result.errors = visitErrorsByType(errors, errorVisitorMap, errorInfo);
  }

  return result;
}

function visitErrorsByType(
  errors: ReadonlyArray<GraphQLError>,
  errorVisitorMap: ErrorVisitorMap,
  errorInfo: ErrorInfo
): Array<GraphQLError> {
  return errors.map(error => {
    const pathSegmentsInfo = errorInfo.segmentInfoMap.get(error);
    if (pathSegmentsInfo == null) {
      return error;
    }
    return pathSegmentsInfo.reduceRight((acc, segmentInfo) => {
      const typeName = segmentInfo.type.name;
      const typeVisitorMap = errorVisitorMap[typeName];
      if (typeVisitorMap == null) {
        return acc;
      }
      const errorVisitor = typeVisitorMap[segmentInfo.fieldName];
      return errorVisitor == null ? acc : errorVisitor(acc as GraphQLError, segmentInfo.pathIndex);
    }, error) as GraphQLError;
  });
}

function visitRoot(
  root: any,
  operation: OperationDefinitionNode,
  exeContext: GraphQLExecutionContext,
  resultVisitorMap: ResultVisitorMap,
  errors: ReadonlyArray<GraphQLError>,
  errorInfo: ErrorInfo
): any {
  const operationRootType = getOperationRootType(exeContext.schema, operation);
  const collectedFields = collectFields(
    exeContext,
    operationRootType,
    operation.selectionSet,
    Object.create(null),
    Object.create(null)
  );

  return visitObjectValue(root, operationRootType, collectedFields, exeContext, resultVisitorMap, 0, errors, errorInfo);
}

function visitObjectValue(
  object: Record<string, any>,
  type: GraphQLObjectType,
  fieldNodeMap: Record<string, Array<FieldNode>>,
  exeContext: GraphQLExecutionContext,
  resultVisitorMap: ResultVisitorMap,
  pathIndex: number,
  errors: ReadonlyArray<GraphQLError>,
  errorInfo: ErrorInfo
): Record<string, any> {
  const fieldMap = type.getFields();
  const typeVisitorMap = resultVisitorMap?.[type.name] as ObjectValueVisitor;

  const enterObject = typeVisitorMap?.__enter as ValueVisitor;
  const newObject = enterObject != null ? enterObject(object) : object;

  let sortedErrors: SortedErrors;
  let errorMap: Record<string, Array<GraphQLError>>;
  if (errors != null) {
    sortedErrors = sortErrorsByPathSegment(errors, pathIndex);
    errorMap = sortedErrors.errorMap;
    errorInfo.unpathedErrors = errorInfo.unpathedErrors.concat(sortedErrors.unpathedErrors);
  }

  Object.keys(fieldNodeMap).forEach(responseKey => {
    const subFieldNodes = fieldNodeMap[responseKey];
    const fieldName = subFieldNodes[0].name.value;
    const fieldType = fieldMap[fieldName].type;

    const newPathIndex = pathIndex + 1;

    let fieldErrors: Array<GraphQLError>;
    if (errors != null) {
      fieldErrors = errorMap[responseKey];
      if (fieldErrors != null) {
        delete errorMap[responseKey];
      }
      addPathSegmentInfo(type, fieldName, newPathIndex, fieldErrors, errorInfo);
    }

    const newValue = visitFieldValue(
      object[responseKey],
      fieldType,
      subFieldNodes,
      exeContext,
      resultVisitorMap,
      newPathIndex,
      fieldErrors,
      errorInfo
    );

    updateObject(newObject, responseKey, newValue, typeVisitorMap, fieldName);
  });

  const oldTypename = newObject.__typename;
  if (oldTypename != null) {
    updateObject(newObject, '__typename', oldTypename, typeVisitorMap, '__typename');
  }

  if (errors != null) {
    Object.keys(errorMap).forEach(unknownResponseKey => {
      errorInfo.unpathedErrors = errorInfo.unpathedErrors.concat(errorMap[unknownResponseKey]);
    });
  }

  const leaveObject = typeVisitorMap?.__leave as ValueVisitor;

  return leaveObject != null ? leaveObject(newObject) : newObject;
}

function updateObject(
  object: Record<string, any>,
  responseKey: string,
  newValue: any,
  typeVisitorMap: ObjectValueVisitor,
  fieldName: string
): void {
  if (typeVisitorMap == null) {
    object[responseKey] = newValue;
    return;
  }

  const fieldVisitor = typeVisitorMap[fieldName];
  if (fieldVisitor == null) {
    object[responseKey] = newValue;
    return;
  }

  const visitedValue = fieldVisitor(newValue);
  if (visitedValue === undefined) {
    delete object[responseKey];
    return;
  }

  object[responseKey] = visitedValue;
}

function visitListValue(
  list: Array<any>,
  returnType: GraphQLOutputType,
  fieldNodes: Array<FieldNode>,
  exeContext: GraphQLExecutionContext,
  resultVisitorMap: ResultVisitorMap,
  pathIndex: number,
  errors: ReadonlyArray<GraphQLError>,
  errorInfo: ErrorInfo
): Array<any> {
  return list.map(listMember =>
    visitFieldValue(listMember, returnType, fieldNodes, exeContext, resultVisitorMap, pathIndex + 1, errors, errorInfo)
  );
}

function visitFieldValue(
  value: any,
  returnType: GraphQLOutputType,
  fieldNodes: Array<FieldNode>,
  exeContext: GraphQLExecutionContext,
  resultVisitorMap: ResultVisitorMap,
  pathIndex: number,
  errors: ReadonlyArray<GraphQLError> = [],
  errorInfo: ErrorInfo
): any {
  if (value == null) {
    return value;
  }

  const nullableType = getNullableType(returnType);
  if (isListType(nullableType)) {
    return visitListValue(
      value as Array<any>,
      nullableType.ofType,
      fieldNodes,
      exeContext,
      resultVisitorMap,
      pathIndex,
      errors,
      errorInfo
    );
  } else if (isAbstractType(nullableType)) {
    const finalType = exeContext.schema.getType(value.__typename) as GraphQLObjectType;
    const collectedFields = collectSubFields(exeContext, finalType, fieldNodes);
    return visitObjectValue(
      value,
      finalType,
      collectedFields,
      exeContext,
      resultVisitorMap,
      pathIndex,
      errors,
      errorInfo
    );
  } else if (isObjectType(nullableType)) {
    const collectedFields = collectSubFields(exeContext, nullableType, fieldNodes);
    return visitObjectValue(
      value,
      nullableType,
      collectedFields,
      exeContext,
      resultVisitorMap,
      pathIndex,
      errors,
      errorInfo
    );
  }

  const typeVisitorMap = resultVisitorMap?.[nullableType.name] as ValueVisitor;
  if (typeVisitorMap == null) {
    return value;
  }

  const visitedValue = typeVisitorMap(value);
  return visitedValue === undefined ? value : visitedValue;
}

function sortErrorsByPathSegment(errors: ReadonlyArray<GraphQLError>, pathIndex: number): SortedErrors {
  const errorMap = Object.create(null);
  const unpathedErrors: Array<GraphQLError> = [];
  errors.forEach(error => {
    const pathSegment = error.path?.[pathIndex];
    if (pathSegment == null) {
      unpathedErrors.push(error);
      return;
    }

    if (pathSegment in errorMap) {
      errorMap[pathSegment].push(error);
    } else {
      errorMap[pathSegment] = [error];
    }
  });

  return {
    errorMap,
    unpathedErrors,
  };
}

function addPathSegmentInfo(
  type: GraphQLObjectType,
  fieldName: string,
  pathIndex: number,
  errors: ReadonlyArray<GraphQLError> = [],
  errorInfo: ErrorInfo
) {
  errors.forEach(error => {
    const segmentInfo = {
      type,
      fieldName,
      pathIndex,
    };
    const pathSegmentsInfo = errorInfo.segmentInfoMap.get(error);
    if (pathSegmentsInfo == null) {
      errorInfo.segmentInfoMap.set(error, [segmentInfo]);
    } else {
      pathSegmentsInfo.push(segmentInfo);
    }
  });
}

function collectSubFields(
  exeContext: GraphQLExecutionContext,
  type: GraphQLObjectType,
  fieldNodes: Array<FieldNode>
): Record<string, Array<FieldNode>> {
  let subFieldNodes: Record<string, Array<FieldNode>> = Object.create(null);
  const visitedFragmentNames = Object.create(null);

  fieldNodes.forEach(fieldNode => {
    subFieldNodes = collectFields(exeContext, type, fieldNode.selectionSet, subFieldNodes, visitedFragmentNames);
  });

  return subFieldNodes;
}
