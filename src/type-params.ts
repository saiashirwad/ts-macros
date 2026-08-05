import type { FunctionBuilder } from "./function.ts"
import type { TypeBuilder } from "./type-decl.ts"
import type * as Type from "./type.ts"

type ApplyTypeParams<Builder, NextTypeParams extends Type.Param<string, any>[]> =
  Builder extends TypeBuilder<infer Body, any>
    ? TypeBuilder<Body, NextTypeParams>
    : Builder extends FunctionBuilder<infer Params, infer Return, any>
      ? FunctionBuilder<Params, Return, NextTypeParams>
      : never

export const TypeParams =
  <const NextTypeParams extends Type.Param<string, any>[]>(...nextTypeParams: NextTypeParams) =>
  <Builder extends TypeBuilder<any, any> | FunctionBuilder<any, any, any>>(
    builder: Builder,
  ): ApplyTypeParams<Builder, NextTypeParams> =>
    (builder as any).withSpec({ ...builder.spec, typeParams: nextTypeParams })
