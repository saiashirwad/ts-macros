export * from "./core.ts"
export * from "./declaration.ts"
export type { Substitute } from "./machinery.ts"
export * from "./nodes/composite.ts"
export * from "./nodes/literal.ts"
export * from "./nodes/primitive.ts"
export * from "./nodes/ref.ts"

import type { AnyParam } from "./core.ts"
import type { ArrayType, FunctionType, Object, TupleType, Union } from "./nodes/composite.ts"
import type { Literal } from "./nodes/literal.ts"
import type { Primitive } from "./nodes/primitive.ts"
import type { Application, TypeRef } from "./nodes/ref.ts"

export type Any =
  | AnyParam
  | Literal
  | Object
  | Union<any>
  | ArrayType
  | TupleType
  | FunctionType
  | TypeRef<any>
  | Primitive
  | Application<any>
