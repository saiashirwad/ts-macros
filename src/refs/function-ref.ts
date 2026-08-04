import type { Expr } from "../foundation/expr.ts"
import type { Param, ParamExprs } from "../functions/params.ts"
import type { TypeParam } from "../type-level/param.ts"

export interface FunctionRef<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
  TypeParams extends readonly TypeParam<string, any>[] = readonly [],
> extends Expr<
  TypeParams extends readonly []
    ? (...args: ParamExprs<Params>) => Return
    : { readonly typeParams: TypeParams; readonly params: Params; readonly return: Return }
> {
  readonly tag: "function-ref"
  readonly name: string
}
