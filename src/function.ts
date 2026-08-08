import type * as Expr from "./expr.ts"
import { makePipeable, PipeableClass } from "./pipeable.ts"
import { type Block, materializeValue, type ReturnValue, type Statement } from "./statement.ts"
import type * as Type from "./types/index.ts"

export interface Param<Name extends string = string, A = unknown> {
  readonly tag: "param"
  readonly name: Name
  readonly type: Type.TypeExpr<A>
}

export type AnyParams = Param<string, any>[]

export const Param = <const Name extends string, A>(
  name: Name,
  type: Type.TypeExpr<A>,
): Param<Name, A> => ({ tag: "param", name, type })

export type ParamBindings<Params extends AnyParams> = {
  readonly [P in Params[number] as P["name"]]: P extends Param<any, infer A> ? Expr.VarRef<A> : never
}

export type ParamExprs<Params extends AnyParams> = {
  [K in keyof Params]: Params[K] extends Param<any, infer A> ? Expr.Expr<A> : never
}

export interface FunctionRef<
  Params extends AnyParams = AnyParams,
  Return = unknown,
> extends Expr.Expr<(...args: ParamExprs<Params>) => Return> {
  readonly tag: "function-ref"
  readonly name: string
}

export interface GenericSignature<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyParams = Type.AnyParams,
> {
  readonly typeParams: TypeParams
  readonly params: Params
  readonly return: Return
}

export interface GenericFunctionRef<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyParams = Type.AnyParams,
> extends Expr.Expr<GenericSignature<Params, Return, TypeParams>> {
  readonly tag: "generic-function-ref"
  readonly name: string
}

/** the ref a function declaration hands back: callable unless the function is generic */
export type Ref<
  Params extends AnyParams,
  Return,
  TypeParams extends Type.AnyParams,
> = TypeParams extends [] ? FunctionRef<Params, Return> : GenericFunctionRef<Params, Return, TypeParams>

export type CallableExpr<Params extends AnyParams = AnyParams, Return = unknown> = Expr.Expr<
  (...args: ParamExprs<Params>) => Return
>

export interface CallExpr<
  Args extends Expr.Expr<any>[] = Expr.Expr<any>[],
  Return = unknown,
> extends Expr.Expr<Return> {
  readonly tag: "call-expr"
  readonly callee: Expr.Expr<(...args: Args) => Return>
  readonly args: Args
}

export const Call = <Args extends Expr.Expr<any>[], Return>(
  callee: Expr.Expr<(...args: Args) => Return>,
  ...args: Args
): CallExpr<Args, Return> => makePipeable({ tag: "call-expr", callee, args })

export type InstantiateParams<
  Params extends AnyParams,
  TypeParams extends Type.AnyParams,
  TypeArgs extends Type.TypeExpr<any>[],
> = {
  [K in keyof Params]: Params[K] extends Param<infer Name, infer A> ? Param<Name, Type.Substitute<A, TypeParams, Type.ArgTypes<TypeArgs>>> : never
}

export interface Instantiation<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyParams = Type.AnyParams,
  TypeArgs extends Type.TypeExpr<any>[] = Type.TypeExpr<any>[],
> extends
  CallableExpr<
    InstantiateParams<Params, TypeParams, TypeArgs>,
    Type.Substitute<Return, TypeParams, Type.ArgTypes<TypeArgs>>
  >
{
  readonly tag: "instantiation"
  readonly callee: GenericFunctionRef<Params, Return, TypeParams>
  readonly typeArgs: TypeArgs
}

export const Instantiate = <
  Params extends AnyParams,
  Return,
  TypeParams extends Type.AnyParams,
  TypeArgs extends Type.TypeExpr<any>[],
>(
  callee: GenericFunctionRef<Params, Return, TypeParams>,
  ...typeArgs: TypeArgs
): Instantiation<Params, Return, TypeParams, TypeArgs> => makePipeable({ tag: "instantiation", callee, typeArgs })

export type FunctionImpl<Params extends AnyParams, Return> = (
  bindings: ParamBindings<Params>,
) => Generator<Statement, Expr.Expr<Return>, unknown>

export interface FunctionDeclaration<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyParams = Type.AnyParams,
> {
  readonly tag: "function-declaration"
  readonly name: string
  readonly typeParams: TypeParams
  readonly params: Params
  readonly returnType?: Type.TypeExpr<Return>
  readonly impl?: FunctionImpl<Params, Return>
  readonly body?: Block
}

export class FunctionBuilder<
  Params extends AnyParams = [],
  Return = unknown,
  TypeParams extends Type.AnyParams = [],
> extends PipeableClass() {
  readonly spec: FunctionDeclaration<Params, Return, TypeParams>

  constructor(spec: FunctionDeclaration<Params, Return, TypeParams>) {
    super()
    this.spec = spec
  }

  *[Symbol.iterator](): Generator<
    FunctionDeclaration<Params, Return, TypeParams>,
    Ref<Params, Return, TypeParams>,
    unknown
  > {
    const { impl, ...rest } = this.spec
    const body = impl === undefined ? undefined : materializeValue(() => {
      const bindings = Object.fromEntries(
        this.spec.params.map((param) => [param.name, makePipeable({ tag: "var-ref", name: param.name })]),
      ) as unknown as ParamBindings<Params>
      return impl(bindings)
    })
    yield {
      ...rest,
      ...(body === undefined ? {} : { body }),
    }
    return makePipeable({
      tag: this.spec.typeParams.length === 0 ? "function-ref" : "generic-function-ref",
      name: this.spec.name,
    }) as Ref<Params, Return, TypeParams>
  }
}

export const Function = (name: string): FunctionBuilder => new FunctionBuilder({ tag: "function-declaration", name, typeParams: [], params: [] })

export const TypeParams =
  <const NextTypeParams extends Type.AnyParams>(...typeParams: NextTypeParams) =>
  <Params extends AnyParams, Return, TypeParams extends Type.AnyParams>(
    builder: FunctionBuilder<Params, Return, TypeParams>,
  ): FunctionBuilder<Params, Return, NextTypeParams> => new FunctionBuilder({ ...builder.spec, typeParams })

export const Params =
  <const NextParams extends AnyParams>(...params: NextParams) =>
  <OldParams extends AnyParams, Return, TypeParams extends Type.AnyParams>(
    builder: FunctionBuilder<OldParams, Return, TypeParams>,
  ): FunctionBuilder<NextParams, Return, TypeParams> =>
    new FunctionBuilder({
      ...builder.spec,
      params,
    } as unknown as FunctionDeclaration<NextParams, Return, TypeParams>)

export const Returns =
  <NextReturn>(returnType: Type.TypeExpr<NextReturn>) =>
  <Params extends AnyParams, CurrentReturn, TypeParams extends Type.AnyParams>(
    builder: FunctionBuilder<Params, CurrentReturn, TypeParams>,
  ): FunctionBuilder<Params, NextReturn, TypeParams> =>
    new FunctionBuilder({
      ...builder.spec,
      returnType,
    } as unknown as FunctionDeclaration<Params, NextReturn, TypeParams>)

type CheckEarlyReturns<Yields, Declared> = [ReturnValue<Yields>] extends [Declared] ? []
  : ["early returns", ReturnValue<Yields>, "do not satisfy the declared return type", Declared]

export const Impl = <
  Params extends AnyParams,
  CurrentReturn,
  TypeParams extends Type.AnyParams,
  Yields extends Statement,
  InferredReturn extends (unknown extends CurrentReturn ? unknown : CurrentReturn),
>(
  implementation: (
    bindings: ParamBindings<Params>,
  ) => Generator<Yields, Expr.Expr<InferredReturn>, unknown>,
) =>
(
  builder: FunctionBuilder<Params, CurrentReturn, TypeParams>,
  ..._check: CheckEarlyReturns<Yields, CurrentReturn>
): FunctionBuilder<
  Params,
  unknown extends CurrentReturn ? InferredReturn | ReturnValue<Yields> : CurrentReturn,
  TypeParams
> =>
  new FunctionBuilder({
    ...builder.spec,
    impl: implementation,
  } as unknown as FunctionDeclaration<
    Params,
    unknown extends CurrentReturn ? InferredReturn | ReturnValue<Yields> : CurrentReturn,
    TypeParams
  >)
