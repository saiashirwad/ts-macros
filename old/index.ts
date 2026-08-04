// Core types
export type {
  Expression,
  Statement,
  TSTypeDescriptor,
  LiteralExpression,
  VariableExpression,
  CallExpression,
  MemberExpression,
  BinaryExpression,
  ArrayExpression,
  ObjectExpression,
  TemplateExpression,
  AwaitExpression,
  UnaryExpression,
  RawExpression,
  RawStatement,
  Param,
  Branded,
} from "./ir.ts"

export { ExprBrand, brand, isExpr } from "./ir.ts"

// Type inference types
export type {
  TypedExpression,
  StringExpr,
  NumberExpr,
  BoolExpr,
  ArrayExpr,
  InferType,
  InferValueType,
  InferTSType,
  ExtractType,
  ExtractIterableElementType,
  NormalizeClassCtor,
  ClassParams,
  ClassInstance,
  ResolvedClassRef,
  ClassConstructorOf,
  ClassInstanceOf,
} from "./types.ts"
export { typedExpr } from "./types.ts"

// Refs
export { VarRef, TypeRef, ClassRef, ClassMemberRef, createTypedVarRef } from "./refs.ts"

// Babel utilities
export {
  generate,
  expressionToBabel,
  statementToBabel,
  typeDescriptorToTSType,
  parseTypeString,
} from "./babel.ts"

// Inference
export { types, typeAliasRegistry, normalizeToExpression, inferExpressionType } from "./infer.ts"

// DSL
export {
  $,
  numeric,
  compare,
  str,
  logic,
  type,
  createInterface,
  createTypeAlias,
  MacroClass,
} from "./dsl.ts"
