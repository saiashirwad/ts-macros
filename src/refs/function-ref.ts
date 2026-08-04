import type { Expr } from "../foundation/expr.ts"
import type { Param, ParamExprs } from "../functions/params.ts"
import { makePipeable } from "../pipeable.ts"
import type { TypeParam } from "../type-level/param.ts"

export interface FunctionLambda<
  TypeParams extends readonly TypeParam<string, any>[] = readonly TypeParam<string, any>[],
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> {
  readonly typeParams: TypeParams
  readonly params: Params
  readonly return: Return
}

export type DeclaredFunction<
  TypeParams extends readonly TypeParam<string, any>[],
  Params extends readonly Param<string, any>[],
  Return,
> = TypeParams extends readonly []
  ? (...args: ParamExprs<Params>) => Return
  : FunctionLambda<TypeParams, Params, Return>

export interface FunctionRef<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
  TypeParams extends readonly TypeParam<string, any>[] = readonly [],
> extends Expr<DeclaredFunction<TypeParams, Params, Return>> {
  readonly _tag: "function-ref"
  readonly name: string
}

export const makeFunctionRef = <
  Params extends readonly Param<string, any>[],
  Return,
  TypeParams extends readonly TypeParam<string, any>[] = readonly [],
>(
  name: string,
): FunctionRef<Params, Return, TypeParams> => makePipeable({ _tag: "function-ref", name })
