import type { Declaration } from "../foundation/declaration.ts"
import type { Expr } from "../foundation/expr.ts"
import type { TypeExpr } from "../foundation/type-expr.ts"
import type { AnyParams, Param, ParamBindings, ParamExprs } from "../functions/params.ts"
import { Class as PipeableClass, makePipeable } from "../pipeable.ts"
import type { FunctionRef } from "../refs/function-ref.ts"
import type { ArgTypes, Substitute } from "../type-level/apply.ts"
import type { TypeParam } from "../type-level/param.ts"

export type CallableExpr<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> = Expr<(...args: ParamExprs<Params>) => Return>

export type InstantiateParams<
  Params extends AnyParams,
  TypeParams extends readonly TypeParam<string, any>[],
  TypeArgs extends readonly TypeExpr<any>[],
> = Params extends readonly [
  infer Head extends Param<string, any>,
  ...infer Tail extends readonly Param<string, any>[],
]
  ? readonly [
      Head extends Param<infer Name, infer A>
        ? Param<Name, Substitute<A, TypeParams, ArgTypes<TypeArgs>>>
        : never,
      ...InstantiateParams<Tail, TypeParams, TypeArgs>,
    ]
  : readonly []

export type InstantiateReturn<
  Return,
  TypeParams extends readonly TypeParam<string, any>[],
  TypeArgs extends readonly TypeExpr<any>[],
> = Substitute<Return, TypeParams, ArgTypes<TypeArgs>>

export interface FunctionTypeApplicationExpr<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
  TypeParams extends readonly TypeParam<string, any>[] = readonly TypeParam<string, any>[],
  TypeArgs extends readonly TypeExpr<any>[] = readonly TypeExpr<any>[],
> extends CallableExpr<
  InstantiateParams<Params, TypeParams, TypeArgs>,
  InstantiateReturn<Return, TypeParams, TypeArgs>
> {
  readonly tag: "function-type-application-expr"
  readonly callee: FunctionRef<Params, Return, TypeParams>
  readonly typeArgs: TypeArgs
}

export interface CallExpr<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
> extends Expr<Return> {
  readonly tag: "call-expr"
  readonly callee: CallableExpr<Params, Return>
  readonly args: ParamExprs<Params>
}

export type FunctionImpl<Params extends readonly Param<string, any>[], Return> = (
  bindings: ParamBindings<Params>,
) => Generator<Declaration, Expr<Return>, unknown>

export interface FunctionDecl<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
  TypeParams extends readonly TypeParam<string, any>[] = readonly [],
> extends Declaration {
  readonly tag: "function-decl"
  readonly name: string
  readonly typeParams: TypeParams
  readonly params: Params
  readonly returnType?: TypeExpr<Return>
  readonly impl?: FunctionImpl<Params, Return>
}

export interface FunctionSpec<
  Params extends readonly Param<string, any>[] = readonly Param<string, any>[],
  Return = unknown,
  TypeParams extends readonly TypeParam<string, any>[] = readonly [],
> {
  readonly name: string
  readonly typeParams: TypeParams
  readonly params: Params
  readonly returnType?: TypeExpr<Return>
  readonly impl?: FunctionImpl<Params, Return>
}

declare const UnsetFunctionReturnId: unique symbol

export interface UnsetFunctionReturn {
  readonly [UnsetFunctionReturnId]: "unset-function-return"
}

type ImplInputBuilder<
  Params extends readonly Param<string, any>[],
  InferredReturn,
  CurrentReturn,
  TypeParams extends readonly TypeParam<string, any>[],
> = [CurrentReturn] extends [UnsetFunctionReturn]
  ? FunctionBuilder<Params, CurrentReturn, TypeParams>
  : [InferredReturn] extends [CurrentReturn]
    ? [CurrentReturn] extends [InferredReturn]
      ? FunctionBuilder<Params, CurrentReturn, TypeParams>
      : never
    : never

type ResolvedFunctionReturn<CurrentReturn, InferredReturn> = [CurrentReturn] extends [
  UnsetFunctionReturn,
]
  ? InferredReturn
  : CurrentReturn

export class FunctionBuilder<
  Params extends readonly Param<string, any>[] = readonly [],
  Return = UnsetFunctionReturn,
  TypeParams extends readonly TypeParam<string, any>[] = readonly [],
> extends PipeableClass() {
  readonly spec: FunctionSpec<Params, Return, TypeParams>

  constructor(spec: FunctionSpec<Params, Return, TypeParams>) {
    super()
    this.spec = spec
  }

  withSpec<
    NextParams extends readonly Param<string, any>[],
    NextReturn,
    NextTypeParams extends readonly TypeParam<string, any>[],
  >(
    spec: FunctionSpec<NextParams, NextReturn, NextTypeParams>,
  ): FunctionBuilder<NextParams, NextReturn, NextTypeParams> {
    return new FunctionBuilder(spec)
  }

  *[Symbol.iterator](): Generator<
    FunctionDecl<Params, Return, TypeParams>,
    FunctionRef<Params, Return, TypeParams>,
    unknown
  > {
    yield {
      tag: "function-decl",
      name: this.spec.name,
      typeParams: this.spec.typeParams,
      params: this.spec.params,
      ...(this.spec.returnType === undefined ? {} : { returnType: this.spec.returnType }),
      ...(this.spec.impl === undefined ? {} : { impl: this.spec.impl }),
    }

    return makePipeable({ tag: "function-ref", name: this.spec.name })
  }
}

export const function_ = (name: string): FunctionBuilder =>
  new FunctionBuilder({
    name,
    typeParams: [],
    params: [],
  })

export const p = <const Name extends string, A>(
  name: Name,
  annotation: TypeExpr<A>,
): Param<Name, A> => ({
  tag: "param",
  name,
  type: annotation,
})

export const params =
  <const Params extends readonly Param<string, any>[]>(...nextParams: Params) =>
  <Return, TypeParams extends readonly TypeParam<string, any>[]>(
    builder: FunctionBuilder<any, Return, TypeParams>,
  ): FunctionBuilder<Params, Return, TypeParams> =>
    builder.withSpec<Params, Return, TypeParams>({
      ...builder.spec,
      params: nextParams,
    } as FunctionSpec<Params, Return, TypeParams>)

export const returns =
  <Return>(returnType: TypeExpr<Return>) =>
  <
    Params extends readonly Param<string, any>[],
    TypeParams extends readonly TypeParam<string, any>[],
  >(
    builder: FunctionBuilder<Params, any, TypeParams>,
  ): FunctionBuilder<Params, Return, TypeParams> =>
    builder.withSpec<Params, Return, TypeParams>({
      ...builder.spec,
      returnType,
    } as FunctionSpec<Params, Return, TypeParams>)

export const impl =
  <
    Params extends readonly Param<string, any>[],
    InferredReturn,
    TypeParams extends readonly TypeParam<string, any>[],
  >(
    implementation: FunctionImpl<Params, InferredReturn>,
  ) =>
  <CurrentReturn>(
    builder: ImplInputBuilder<Params, InferredReturn, CurrentReturn, TypeParams>,
  ): FunctionBuilder<Params, ResolvedFunctionReturn<CurrentReturn, InferredReturn>, TypeParams> =>
    builder.withSpec({
      ...builder.spec,
      impl: implementation,
    } as FunctionSpec<Params, ResolvedFunctionReturn<CurrentReturn, InferredReturn>, TypeParams>)

export const call = <Params extends readonly Param<string, any>[], Return>(
  callee: CallableExpr<Params, Return>,
  args: ParamExprs<Params>,
): CallExpr<Params, Return> => makePipeable({ tag: "call-expr", callee, args })

export const instantiate = <
  Params extends readonly Param<string, any>[],
  Return,
  TypeParams extends readonly TypeParam<string, any>[],
  const TypeArgs extends readonly TypeExpr<any>[],
>(
  callee: FunctionRef<Params, Return, TypeParams>,
  ...typeArgs: TypeArgs
): FunctionTypeApplicationExpr<Params, Return, TypeParams, TypeArgs> =>
  makePipeable({ tag: "function-type-application-expr", callee, typeArgs })
