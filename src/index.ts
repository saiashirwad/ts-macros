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
} from "./ir";

export { ExprBrand, brand, isExpr } from "./ir";

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
} from "./types";
export { typedExpr } from "./types";

// Refs
export { VarRef, TypeRef, ClassRef, ClassMemberRef, createTypedVarRef } from "./refs";

// Babel utilities
export {
  generate,
  expressionToBabel,
  statementToBabel,
  typeDescriptorToTSType,
  parseTypeString,
} from "./babel";

// Inference
export { types, typeAliasRegistry, normalizeToExpression, inferExpressionType } from "./infer";

// DSL
export { $, numeric, compare, str, logic, type, createInterface, createTypeAlias } from "./dsl";
