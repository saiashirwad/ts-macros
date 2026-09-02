export * from "./core.ts"
export * from "./declaration.ts"
export * from "./nodes.ts"

import type { AnyParam } from "./core.ts"
import type {
  ArrayType,
  Conditional,
  FunctionType,
  IndexedAccess,
  InferVar,
  Intersection,
  KeyOf,
  Literal,
  Mapped,
  Object,
  OptionalField,
  Primitive,
  ReadonlyField,
  TemplateLiteralType,
  TupleType,
  TypeRef,
  Union,
} from "./nodes.ts"

/** every type node kind, so passes and emitters can switch exhaustively */
export type Any =
  | Primitive
  | Literal
  | TemplateLiteralType
  | AnyParam
  | InferVar
  | Object
  | ReadonlyField
  | OptionalField
  | Union
  | Intersection
  | ArrayType
  | TupleType
  | FunctionType
  | IndexedAccess
  | KeyOf
  | Conditional
  | Mapped
  | TypeRef<any>
