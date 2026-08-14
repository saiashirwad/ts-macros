import * as Expr from "./expr.ts"
import type { Denote, In, Shape } from "./norm.ts"
import { makePipeable, PipeableClass } from "./pipeable.ts"
import { type Block, materializeValue, type ReturnValue, type Statement } from "./statement.ts"
import type * as Type from "./types/index.ts"

export type ParamKind = "required" | "optional" | "rest"

export interface Param<
  Name extends string = string,
  A = unknown,
  Kind extends ParamKind = "required",
> {
  readonly tag: "param"
  readonly name: Name
  readonly type: Type.TypeExpr<A>
  readonly kind?: Kind
}

export type AnyParam = Param<string, any, any>
export type AnyParams = AnyParam[]

export const Param = <const Name extends string, A>(
  name: Name,
  type: Type.TypeExpr<A>,
): Param<Name, A> => ({ tag: "param", name, type })

export const Optional = <const Name extends string, A>(
  name: Name,
  type: Type.TypeExpr<A>,
): Param<Name, A, "optional"> => ({ tag: "param", name, type, kind: "optional" })

export const Rest = <const Name extends string, A>(
  name: Name,
  type: Type.TypeExpr<A>,
): Param<Name, A, "rest"> => ({ tag: "param", name, type, kind: "rest" })

export type PlainParams<Params extends AnyParams> =
    Params extends [
      infer Head extends Param<string, any, any>,
      ...infer Tail extends AnyParams,
    ] ?
      Head extends Param<any, infer A, infer Kind> ?
        Kind extends "rest" ? [...A[]]
      : Kind extends "optional" ? [item?: A | undefined, ...rest: PlainParams<Tail>]
      : [A, ...PlainParams<Tail>]
    : never
  : []

export type ParamBindings<Params extends AnyParams> = {
  readonly [P in Params[number] as P["name"]]: P extends Param<any, infer A, infer Kind>
    ? Expr.VarRef<Kind extends "rest" ? A[] : Kind extends "optional" ? A | undefined : A>
    : never
}

type ExprsOf<Params extends unknown[]> = { [K in keyof Params]: Expr.Expr<Params[K]> }

const paramBindings = <Params extends AnyParams>(params: Params): ParamBindings<Params> =>
  Object.fromEntries(
    params.map((param) => [param.name, makePipeable({ tag: "var-ref", name: param.name })]),
  ) as unknown as ParamBindings<Params>

export type FunctionRef<
  Params extends AnyParams = AnyParams,
  Return = unknown,
> = Expr.VarRef<(...args: PlainParams<Params>) => Return, false>

export interface GenericSignature<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyParams = Type.AnyParams,
> {
  readonly typeParams: TypeParams
  readonly params: Params
  readonly return: Return
}

export type GenericFunctionRef<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyParams = Type.AnyParams,
> = Expr.VarRef<GenericSignature<Params, Return, TypeParams>, false>

export type DeclaredRef<
  Params extends AnyParams = AnyParams,
  Return = unknown,
> = FunctionRef<Params, Return> & Shape<(...args: PlainParams<Params>) => Return>

export type Ref<
  Params extends AnyParams,
  Return,
  TypeParams extends Type.AnyParams,
> = TypeParams extends [] ? DeclaredRef<Params, Return> : GenericFunctionRef<Params, Return, TypeParams>

export type CallableExpr<Params extends AnyParams = AnyParams, Return = unknown> = Expr.Expr<
  (...args: PlainParams<Params>) => Return
>

export interface CallExpr<
  Args extends Expr.Expr<any>[] = Expr.Expr<any>[],
  Return = unknown,
> extends Expr.Expr<Return> {
  readonly tag: "call-expr"
  readonly callee: Expr.Expr<any>
  readonly args: Args
}

type CheckCallable<Sig> = Sig extends (...args: any[]) => any ? [] : ["callee is not callable — did you forget Instantiate?", Sig]

export const Call = <const Args extends Expr.Expr<any>[], Sig>(
  callee: Expr.Expr<Sig>,
  ...args: [
    ...(Sig extends (...args: infer P) => any ? Args & ExprsOf<P> : Args),
    ...CheckCallable<Sig>,
  ]
): CallExpr<Args, Sig extends (...args: any[]) => infer R ? R : never> => makePipeable({ tag: "call-expr", callee, args: args as unknown as Args })

export const MethodCall = <
  const O extends Expr.Expr<any>,
  const K extends string & keyof Expr.Denotes<O>,
  const Args extends Expr.Expr<any>[],
>(
  object: O,
  key: K,
  ...args: Expr.Denotes<O>[K] extends (...args: infer P) => any ? Args & ExprsOf<P> : never
): CallExpr<Args, Expr.Denotes<O>[K] extends (...args: any[]) => infer R ? R : never> =>
  makePipeable({ tag: "call-expr", callee: Expr.Prop(object, key), args })

export type InstantiateParams<
  Params extends AnyParams,
  TypeParams extends Type.AnyParams,
  TypeArgs extends Type.TypeExpr<any>[],
> = {
  [K in keyof Params]: Params[K] extends Param<infer Name, infer A, infer Kind>
    ? Param<Name, Type.Substitute<A, TypeParams, Type.ArgTypes<TypeArgs>>, Kind>
    : never
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
  readonly callee: Expr.Expr<GenericSignature<Params, Return, TypeParams>>
  readonly typeArgs: TypeArgs
}

export const Instantiate = <
  Params extends AnyParams,
  Return,
  TypeParams extends Type.AnyParams,
  TypeArgs extends Type.TypeExpr<any>[],
>(
  callee: Expr.Expr<GenericSignature<Params, Return, TypeParams>>,
  ...typeArgs: TypeArgs
): Instantiation<Params, Return, TypeParams, TypeArgs> => makePipeable({ tag: "instantiation", callee, typeArgs })

export type FunctionImpl<Params extends AnyParams, Return> = (
  bindings: ParamBindings<Params>,
) => Generator<Statement, In<Return>, unknown>

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
  // spec-only, stripped before the node is yielded: how the yield* ref is
  // built. sugar injects the callable surface here; core stays a plain node
  readonly ref?: (name: string) => unknown
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
    const { impl, ref, ...rest } = this.spec
    const body = impl === undefined ? undefined : materializeValue(() => impl(paramBindings(this.spec.params)))
    yield {
      ...rest,
      ...(body === undefined ? {} : { body }),
    }
    if (this.spec.typeParams.length === 0 && ref !== undefined) {
      return ref(this.spec.name) as Ref<Params, Return, TypeParams>
    }
    return makePipeable({
      tag: "var-ref",
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
  const TR extends (unknown extends CurrentReturn ? unknown : In<CurrentReturn>),
>(
  implementation: (
    bindings: ParamBindings<Params>,
  ) => Generator<Yields, TR, unknown>,
) =>
(
  builder: FunctionBuilder<Params, CurrentReturn, TypeParams>,
  ..._check: CheckEarlyReturns<Yields, CurrentReturn>
): FunctionBuilder<
  Params,
  unknown extends CurrentReturn ? Denote<TR> | ReturnValue<Yields> : CurrentReturn,
  TypeParams
> =>
  new FunctionBuilder({
    ...builder.spec,
    impl: implementation,
  } as unknown as FunctionDeclaration<
    Params,
    unknown extends CurrentReturn ? Denote<TR> | ReturnValue<Yields> : CurrentReturn,
    TypeParams
  >)

export interface Arrow<Params extends AnyParams = AnyParams, Return = unknown> extends
  Expr.Expr<
    (...args: PlainParams<Params>) => Return
  >
{
  readonly tag: "arrow"
  readonly params: Params
  readonly body: Block
}

export const Arrow = <const Params extends AnyParams, Yields extends Statement, Return>(
  params: Params,
  impl: (bindings: ParamBindings<Params>) => Generator<Yields, Return, unknown>,
): Arrow<Params, Denote<Return> | ReturnValue<Yields>> =>
  makePipeable({ tag: "arrow", params, body: materializeValue(() => impl(paramBindings(params))) })
