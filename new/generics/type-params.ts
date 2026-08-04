import type { FunctionBuilder } from "../declarations/function";
import type { TypeBuilder } from "../declarations/type";
import type { TypeParam } from "../type-level/param";

type ApplyTypeParams<
  Builder,
  NextTypeParams extends readonly TypeParam<string, any>[],
> =
  Builder extends TypeBuilder<infer Body, any> ?
  TypeBuilder<Body, NextTypeParams>
  : Builder extends FunctionBuilder<infer Params, infer Return, any> ?
  FunctionBuilder<Params, Return, NextTypeParams>
  : never;

export const typeParams =
  <const NextTypeParams extends readonly TypeParam<string, any>[]>(
    ...nextTypeParams: NextTypeParams
  ) =>
    <Builder extends TypeBuilder<any, any> | FunctionBuilder<any, any, any>>(
      builder: Builder,
    ): ApplyTypeParams<Builder, NextTypeParams> =>
      (builder as any).withSpec({
        ...builder.spec,
        typeParams: nextTypeParams,
      }) as ApplyTypeParams<Builder, NextTypeParams>;
