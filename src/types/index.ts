export * from "./core.ts"
export * from "./declaration.ts"
export * from "./nodes.ts"

import type { AnyParam } from "./core.ts"
import type { ArrayType, FunctionType, Literal, Object, Primitive, TupleType, TypeRef, Union } from "./nodes.ts"

/** every type node kind, so passes and emitters can switch exhaustively */
export type Any =
  | Primitive
  | Literal
  | AnyParam
  | Object
  | Union
  | ArrayType
  | TupleType
  | FunctionType
  | TypeRef<any>
