import { GraphQLSchema, GraphQLObjectType, getNullableType } from 'graphql';

import {
  wrapFieldNode,
  renameFieldNode,
  appendObjectFields,
  removeObjectFields,
  Transform,
  Request,
  ExecutionResult,
  unwrapValue,
} from '@graphql-tools/utils';

import { defaultMergedResolver } from '@graphql-tools/delegate';

import MapFields from './MapFields';

export default class HoistField implements Transform {
  private readonly typeName: string;
  private readonly newFieldName: string;
  private readonly pathToField: Array<string>;
  private readonly oldFieldName: string;
  private readonly transformer: Transform;

  constructor(typeName: string, path: Array<string>, newFieldName: string) {
    this.typeName = typeName;
    this.newFieldName = newFieldName;

    const pathToField = path.slice();
    const oldFieldName = pathToField.pop();

    this.oldFieldName = oldFieldName;
    this.pathToField = pathToField;
    this.transformer = new MapFields(
      {
        [typeName]: {
          [newFieldName]: fieldNode => wrapFieldNode(renameFieldNode(fieldNode, oldFieldName), pathToField),
        },
      },
      {
        [typeName]: value => {
          return unwrapValue(value, pathToField);
        },
      }
    );
  }

  public transformSchema(schema: GraphQLSchema): GraphQLSchema {
    const innerType: GraphQLObjectType = this.pathToField.reduce(
      (acc, pathSegment) => getNullableType(acc.getFields()[pathSegment].type) as GraphQLObjectType,
      schema.getType(this.typeName) as GraphQLObjectType
    );

    let [newSchema, targetFieldConfigMap] = removeObjectFields(
      schema,
      innerType.name,
      fieldName => fieldName === this.oldFieldName
    );

    const targetField = targetFieldConfigMap[this.oldFieldName];

    const targetType = targetField.type as GraphQLObjectType;

    newSchema = appendObjectFields(newSchema, this.typeName, {
      [this.newFieldName]: {
        type: targetType,
        resolve: defaultMergedResolver,
      },
    });

    return this.transformer.transformSchema(newSchema);
  }

  public transformRequest(
    originalRequest: Request,
    delegationContext?: Record<string, any>,
    transformationContext?: Record<string, any>
  ): Request {
    return this.transformer.transformRequest(originalRequest, delegationContext, transformationContext);
  }

  public transformResult(
    originalResult: ExecutionResult,
    delegationContext?: Record<string, any>,
    transformationContext?: Record<string, any>
  ): ExecutionResult {
    return this.transformer.transformResult(originalResult, delegationContext, transformationContext);
  }
}
