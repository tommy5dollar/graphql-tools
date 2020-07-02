import { GraphQLSchema, GraphQLObjectType, GraphQLResolveInfo, GraphQLFieldResolver } from 'graphql';

import {
  Transform,
  Request,
  hoistFieldNodes,
  appendObjectFields,
  selectObjectFields,
  modifyObjectFields,
  ExecutionResult,
  dehoistValue,
  dehoistErrors,
} from '@graphql-tools/utils';

import { defaultMergedResolver } from '@graphql-tools/delegate';

import MapFields from './MapFields';

function defaultWrappingResolver(
  parent: any,
  args: Record<string, any>,
  context: Record<string, any>,
  info: GraphQLResolveInfo
): any {
  if (!parent) {
    return {};
  }

  return defaultMergedResolver(parent, args, context, info);
}

export default class WrapFields implements Transform {
  private readonly outerTypeName: string;
  private readonly wrappingFieldNames: Array<string>;
  private readonly wrappingTypeNames: Array<string>;
  private readonly numWraps: number;
  private readonly fieldNames: Array<string>;
  private readonly wrappingResolver: GraphQLFieldResolver<any, any>;
  private readonly transformer: Transform;

  constructor(
    outerTypeName: string,
    wrappingFieldNames: Array<string>,
    wrappingTypeNames: Array<string>,
    fieldNames?: Array<string>,
    wrappingResolver: GraphQLFieldResolver<any, any> = defaultWrappingResolver
  ) {
    this.outerTypeName = outerTypeName;
    this.wrappingFieldNames = wrappingFieldNames;
    this.wrappingTypeNames = wrappingTypeNames;
    this.numWraps = wrappingFieldNames.length;
    this.fieldNames = fieldNames;
    this.wrappingResolver = wrappingResolver;

    const remainingWrappingFieldNames = this.wrappingFieldNames.slice();
    const outerMostWrappingFieldName = remainingWrappingFieldNames.shift();
    this.transformer = new MapFields(
      {
        [outerTypeName]: {
          [outerMostWrappingFieldName]: (fieldNode, fragments) =>
            hoistFieldNodes({
              fieldNode,
              path: remainingWrappingFieldNames,
              fieldNames,
              fragments,
            }),
        },
      },
      {
        [outerTypeName]: value => dehoistValue(value),
      },
      errors => dehoistErrors(errors)
    );
  }

  public transformSchema(schema: GraphQLSchema): GraphQLSchema {
    const targetFieldConfigMap = selectObjectFields(
      schema,
      this.outerTypeName,
      !this.fieldNames ? () => true : fieldName => this.fieldNames.includes(fieldName)
    );

    let wrapIndex = this.numWraps - 1;
    let wrappingTypeName = this.wrappingTypeNames[wrapIndex];
    let wrappingFieldName = this.wrappingFieldNames[wrapIndex];

    let newSchema = appendObjectFields(schema, wrappingTypeName, targetFieldConfigMap);

    for (wrapIndex--; wrapIndex > -1; wrapIndex--) {
      const nextWrappingTypeName = this.wrappingTypeNames[wrapIndex];

      newSchema = appendObjectFields(newSchema, nextWrappingTypeName, {
        [wrappingFieldName]: {
          type: newSchema.getType(wrappingTypeName) as GraphQLObjectType,
          resolve: this.wrappingResolver,
        },
      });

      wrappingTypeName = nextWrappingTypeName;
      wrappingFieldName = this.wrappingFieldNames[wrapIndex];
    }

    const selectedFieldNames = Object.keys(targetFieldConfigMap);
    [newSchema] = modifyObjectFields(
      newSchema,
      this.outerTypeName,
      fieldName => selectedFieldNames.includes(fieldName),
      {
        [wrappingFieldName]: {
          type: newSchema.getType(wrappingTypeName) as GraphQLObjectType,
          resolve: this.wrappingResolver,
        },
      }
    );

    return this.transformer.transformSchema(newSchema);
  }

  public transformRequest(
    originalRequest: Request,
    delegationContext: Record<string, any>,
    transformationContext: Record<string, any>
  ): Request {
    return this.transformer.transformRequest(originalRequest, delegationContext, transformationContext);
  }

  public transformResult(
    originalResult: ExecutionResult,
    delegationContext: Record<string, any>,
    transformationContext: Record<string, any>
  ): ExecutionResult {
    return this.transformer.transformResult(originalResult, delegationContext, transformationContext);
  }
}
