import type { TypeBuilder } from "./type-decl.ts"
import type * as Type from "./type.ts"

export const TypeParams =
  <const Params extends Type.AnyParams>(...params: Params) =>
  <Body>(builder: TypeBuilder<Body, any>) =>
    builder.withSpec({ ...builder.spec, params })
