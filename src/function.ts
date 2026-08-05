import type { Declaration } from "./declaration.ts"
import type * as Expr from "./expr.ts"
import { PipeableClass, makePipeable } from "./pipeable.ts"
import type * as Type from "./type.ts"

export interface Param<Name extends string = string, A = unknown> {
  readonly tag: "param"
  readonly name: Name
  readonly type: Type.TypeExpr<A>
}

export type AnyParams = readonly Param<string, any>[]

export type ParamBindings<Params extends AnyParams> = {
  readonly [P in Params[number] as P["name"]]: P extends Param<any, infer A>
    ? Expr.VarRef<A>
    : never
}

export type ParamExprs<Params extends AnyParams> = {
  readonly [K in keyof Params]: Params[K] extends Param<any, infer A> ? Expr.Expr<A> : never
}

export interface FunctionRef<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.Param<string, any>[] = [],
> extends Expr.Expr<
  TypeParams extends []
    ? (...args: ParamExprs<Params>) => Return
    : { readonly typeParams: TypeParams; readonly params: Params; readonly return: Return }
> {
  readonly tag: "function-ref"
  readonly name: string
}

export type CallableExpr<Params extends AnyParams = AnyParams, Return = unknown> = Expr.Expr<
  (...args: ParamExprs<Params>) => Return
>

export type InstantiateParams<
  Params extends AnyParams,
  TypeParams extends Type.Param<string, any>[],
  TypeArgs extends Type.TypeExpr<any>[],
> = Params extends readonly [infer Head extends Param<string, any>, ...infer Tail extends AnyParams]
  ? readonly [
      Head extends Param<infer Name, infer A>
        ? Param<Name, Type.Substitute<A, TypeParams, Type.ArgTypes<TypeArgs>>>
        : never,
      ...InstantiateParams<Tail, TypeParams, TypeArgs>,
    ]
  : readonly []

export type InstantiateReturn<
  Return,
  TypeParams extends Type.Param<string, any>[],
  TypeArgs extends Type.TypeExpr<any>[],
> = Type.Substitute<Return, TypeParams, Type.ArgTypes<TypeArgs>>

export interface FunctionTypeApplicationExpr<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.Param<string, any>[] = Type.Param<string, any>[],
  TypeArgs extends Type.TypeExpr<any>[] = Type.TypeExpr<any>[],
> extends CallableExpr<
  InstantiateParams<Params, TypeParams, TypeArgs>,
  InstantiateReturn<Return, TypeParams, TypeArgs>
> {
  readonly tag: "function-type-application-expr"
  readonly callee: FunctionRef<Params, Return, TypeParams>
  readonly typeArgs: TypeArgs
}

export interface CallExpr<
  Params extends AnyParams = AnyParams,
  Return = unknown,
> extends Expr.Expr<Return> {
  readonly tag: "call-expr"
  readonly callee: CallableExpr<Params, Return>
  readonly args: ParamExprs<Params>
}

export type FunctionImpl<Params extends AnyParams, Return> = (
  bindings: ParamBindings<Params>,
) => Generator<Declaration, Expr.Expr<Return>, unknown>

export interface FunctionDeclaration<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.Param<string, any>[] = [],
> {
  readonly tag: "function-declaration"
  readonly name: string
  readonly typeParams: TypeParams
  readonly params: Params
  readonly returnType?: Type.TypeExpr<Return>
  readonly impl?: FunctionImpl<Params, Return>
}

declare const UnsetFunctionReturnId: unique symbol

export interface UnsetFunctionReturn {
  readonly [UnsetFunctionReturnId]: "unset-function-return"
}

type ImplInputBuilder<
  Params extends AnyParams,
  InferredReturn,
  CurrentReturn,
  TypeParams extends Type.Param<string, any>[],
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
  Params extends AnyParams = readonly [],
  Return = UnsetFunctionReturn,
  TypeParams extends Type.Param<string, any>[] = [],
> extends PipeableClass() {
  readonly spec: FunctionDeclaration<Params, Return, TypeParams>

  constructor(spec: FunctionDeclaration<Params, Return, TypeParams>) {
    super()
    this.spec = spec
  }

  withSpec<
    NextParams extends AnyParams,
    NextReturn,
    NextTypeParams extends Type.Param<string, any>[],
  >(
    spec: FunctionDeclaration<NextParams, NextReturn, NextTypeParams>,
  ): FunctionBuilder<NextParams, NextReturn, NextTypeParams> {
    return new FunctionBuilder(spec)
  }

  *[Symbol.iterator](): Generator<
    FunctionDeclaration<Params, Return, TypeParams>,
    FunctionRef<Params, Return, TypeParams>,
    unknown
  > {
    yield {
      tag: "function-declaration",
      name: this.spec.name,
      typeParams: this.spec.typeParams,
      params: this.spec.params,
      ...(this.spec.returnType === undefined ? {} : { returnType: this.spec.returnType }),
      ...(this.spec.impl === undefined ? {} : { impl: this.spec.impl }),
    }

    return makePipeable({ tag: "function-ref", name: this.spec.name })
  }
}

export const Function = (name: string): FunctionBuilder =>
  new FunctionBuilder({ tag: "function-declaration", name, typeParams: [], params: [] })

export const Param = <const Name extends string, A>(
  name: Name,
  annotation: Type.TypeExpr<A>,
): Param<Name, A> => ({ tag: "param", name, type: annotation })

export const Params =
  <const Params extends AnyParams>(...nextParams: Params) =>
  <Return, TypeParams extends Type.Param<string, any>[]>(
    builder: FunctionBuilder<any, Return, TypeParams>,
  ): FunctionBuilder<Params, Return, TypeParams> =>
    builder.withSpec<Params, Return, TypeParams>({ ...builder.spec, params: nextParams })

export const Returns =
  <Return>(returnType: Type.TypeExpr<Return>) =>
  <Params extends AnyParams, TypeParams extends Type.Param<string, any>[]>(
    builder: FunctionBuilder<Params, any, TypeParams>,
  ): FunctionBuilder<Params, Return, TypeParams> =>
    builder.withSpec<Params, Return, TypeParams>({
      ...builder.spec,
      returnType,
    } as FunctionDeclaration<Params, Return, TypeParams>)

export const Impl =
  <Params extends AnyParams, InferredReturn, TypeParams extends Type.Param<string, any>[]>(
    implementation: FunctionImpl<Params, InferredReturn>,
  ) =>
  <CurrentReturn>(
    builder: ImplInputBuilder<Params, InferredReturn, CurrentReturn, TypeParams>,
  ): FunctionBuilder<Params, ResolvedFunctionReturn<CurrentReturn, InferredReturn>, TypeParams> =>
    builder.withSpec({
      ...builder.spec,
      impl: implementation,
    } as FunctionDeclaration<
      Params,
      ResolvedFunctionReturn<CurrentReturn, InferredReturn>,
      TypeParams
    >)

export const Call = <Params extends AnyParams, Return>(
  callee: CallableExpr<Params, Return>,
  args: ParamExprs<Params>,
): CallExpr<Params, Return> => makePipeable({ tag: "call-expr", callee, args })

export const Instantiate = <
  Params extends AnyParams,
  Return,
  TypeParams extends Type.Param<string, any>[],
  const TypeArgs extends Type.TypeExpr<any>[],
>(
  callee: FunctionRef<Params, Return, TypeParams>,
  ...typeArgs: TypeArgs
): FunctionTypeApplicationExpr<Params, Return, TypeParams, TypeArgs> =>
  makePipeable({ tag: "function-type-application-expr", callee, typeArgs })

export const TypeParams =
  <const TypeParams extends Type.AnyParams>(...typeParams: TypeParams) =>
  <Params extends AnyParams, Return>(builder: FunctionBuilder<Params, Return, any>) =>
    builder.withSpec({ ...builder.spec, typeParams })
