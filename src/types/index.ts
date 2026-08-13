export * from "./core.ts"
export * from "./declaration.ts"
export type { Abstract, Op, Operators, Substitute } from "./machinery.ts"
export * from "./nodes/composite.ts"
export * from "./nodes/literal.ts"
export * from "./nodes/primitive.ts"
export * from "./nodes/ref.ts"

import type { AnyParam } from "./core.ts"
import type {
  ArrayType,
  Conditional,
  FunctionType,
  IndexedAccess,
  InferVar,
  Intersection,
  KeyOf,
  Mapped,
  Object,
  OptionalField,
  ReadonlyField,
  TemplateLiteralType,
  TupleType,
  Union,
} from "./nodes/composite.ts"
import type { Literal } from "./nodes/literal.ts"
import type { Primitive } from "./nodes/primitive.ts"
import type { Application, TypeRef } from "./nodes/ref.ts"

export type Any =
  | AnyParam
  | Literal
  | Object
  | Union<any>
  | Intersection
  | ArrayType
  | TupleType
  | FunctionType
  | IndexedAccess
  | KeyOf
  | Conditional
  | Mapped
  | TemplateLiteralType
  | InferVar
  | ReadonlyField
  | OptionalField
  | TypeRef<any>
  | Primitive
  | Application<any>
