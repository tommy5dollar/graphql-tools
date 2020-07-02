import {
  GraphQLSchema,
  GraphQLFieldResolver,
  BuildSchemaOptions,
  GraphQLInputFieldConfig,
  GraphQLFieldConfig,
  FieldNode,
  FragmentDefinitionNode,
  SelectionNode,
  ObjectFieldNode,
  ObjectValueNode,
  GraphQLError,
} from 'graphql';
import { Executor, Subscriber, DelegationContext } from '@graphql-tools/delegate';
import { Request } from '@graphql-tools/utils';

export interface IMakeRemoteExecutableSchemaOptions {
  schema: GraphQLSchema | string;
  executor?: Executor;
  subscriber?: Subscriber;
  createResolver?: (executor: Executor, subscriber: Subscriber) => GraphQLFieldResolver<any, any>;
  buildSchemaOptions?: BuildSchemaOptions;
}

export type InputFieldTransformer = (
  typeName: string,
  fieldName: string,
  inputFieldConfig: GraphQLInputFieldConfig
) => GraphQLInputFieldConfig | [string, GraphQLInputFieldConfig] | null | undefined;

export type InputFieldNodeTransformer = (
  typeName: string,
  fieldName: string,
  inputFieldNode: ObjectFieldNode,
  request: Request,
  delegationContext?: DelegationContext
) => ObjectFieldNode | Array<ObjectFieldNode>;

export type InputObjectNodeTransformer = (
  typeName: string,
  inputObjectNode: ObjectValueNode,
  request: Request,
  delegationContext?: DelegationContext
) => ObjectValueNode;

export type FieldTransformer = (
  typeName: string,
  fieldName: string,
  fieldConfig: GraphQLFieldConfig<any, any>
) => GraphQLFieldConfig<any, any> | [string, GraphQLFieldConfig<any, any>] | null | undefined;

export type RootFieldTransformer = (
  operation: 'Query' | 'Mutation' | 'Subscription',
  fieldName: string,
  fieldConfig: GraphQLFieldConfig<any, any>
) => GraphQLFieldConfig<any, any> | [string, GraphQLFieldConfig<any, any>] | null | undefined;

export type FieldNodeTransformer = (
  typeName: string,
  fieldName: string,
  fieldNode: FieldNode,
  fragments: Record<string, FragmentDefinitionNode>,
  context: Record<string, any>
) => SelectionNode | Array<SelectionNode>;

export type DataTransformer = (value: any, context?: Record<string, any>) => any;

export type ObjectValueTransformerMap = Record<string, DataTransformer>;

export type ErrorsTransformer = (
  errors: ReadonlyArray<GraphQLError>,
  context: Record<string, any>
) => Array<GraphQLError>;
