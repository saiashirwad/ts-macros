import * as Expr from "./expr.ts"
import { type BindingId, freshBindingId, type ValueBinding, type ValueReference } from "./identity.ts"
import { Builder, makePipeable, makeTypeNode, makeYieldable } from "./pipeable.ts"
import { type Block, materializeValue, returnType, type ReturnValue, type Statement } from "./statement.ts"
import { type Callable, callable } from "./sugar/surface.ts"
import * as Type from "./types/index.ts"

export type ParamKind = "required" | "optional" | "rest"

export interface Param<Name extends string = string, A = unknown, Kind extends ParamKind = "required"> extends ValueBinding {
  readonly tag: "param"
  readonly id: BindingId
  readonly nameHint: Name
  readonly type: Type.TypeExpr<A>
  readonly kind?: Kind
}

export type AnyParam = Param<string, any, any>
export type AnyParams = AnyParam[]

export const Param = <const Name extends string, A>(nameHint: Name, type: Type.TypeExpr<A>): Param<Name, A> =>
  makePipeable({ tag: "param", id: freshBindingId(), nameHint, type })

export const Optional = <const Name extends string, A>(nameHint: Name, type: Type.TypeExpr<A>): Param<Name, A, "optional"> =>
  makePipeable({ tag: "param", id: freshBindingId(), nameHint, type, kind: "optional" })

export const Rest = <const Name extends string, A>(nameHint: Name, type: Type.TypeExpr<A>): Param<Name, A, "rest"> =>
  makePipeable({ tag: "param", id: freshBindingId(), nameHint, type, kind: "rest" })

/** the argument tuple a parameter list accepts */
export type PlainParams<Params extends AnyParams> =
    Params extends [infer Head extends Param<string, any, any>, ...infer Tail extends AnyParams] ?
      Head extends Param<any, infer A, infer Kind> ?
        Kind extends "rest" ? [...A[]]
      : Kind extends "optional" ? [item?: A | undefined, ...rest: PlainParams<Tail>]
      : [A, ...PlainParams<Tail>]
    : never
  : []

/** the refs an implementation receives, keyed by parameter name */
export type ParamBindings<Params extends AnyParams> = {
  readonly [P in Params[number] as P["nameHint"]]: P extends Param<any, infer A, infer Kind>
    ? Expr.VarRef<Kind extends "rest" ? A[] : Kind extends "optional" ? A | undefined : A>
    : never
}

export const paramBindings = <Params extends AnyParams>(params: Params): ParamBindings<Params> =>
  Object.fromEntries(params.map((param) => [param.nameHint, Expr.LocalRef(param.id, param.nameHint, param.type)])) as unknown as ParamBindings<Params>

/** the type of a function with these params and return type */
export const signatureType = (params: ReadonlyArray<AnyParam>, returnType: Type.TypeExpr<any>): Type.FunctionType =>
  Type.Function(params.map((param) => param.type), returnType)

/** the return type of a call to `callee`, when its type is a known function type */
export const callType = (callee: Expr.Expr<any>): Type.TypeExpr<any> | undefined => {
  const type = callee.type as Type.Any | undefined
  return type?.tag === "function" ? type.return : undefined
}

export interface FunctionRef<Params extends AnyParams = AnyParams, Return = unknown>
  extends Expr.Expr<(...args: PlainParams<Params>) => Return>, ValueReference
{
  readonly tag: "function-ref"
  readonly target: BindingId
  readonly nameHint: string
  readonly type?: Type.FunctionType | undefined
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
> extends Expr.Expr<GenericSignature<Params, Return, TypeParams>>, ValueReference {
  readonly tag: "generic-function-ref"
  readonly target: BindingId
  readonly nameHint: string
  readonly type?: Type.FunctionType | undefined
  readonly typeParams: TypeParams
}

/** the ref a function declaration hands back: callable like a function unless it is generic (instantiate it first) */
export type Ref<Params extends AnyParams, Return, TypeParams extends Type.AnyParams> = TypeParams extends [] ? Callable<FunctionRef<Params, Return>>
  : GenericFunctionRef<Params, Return, TypeParams>

export type CallableExpr<Params extends AnyParams = AnyParams, Return = unknown> = Expr.Expr<(...args: PlainParams<Params>) => Return>

export interface CallExpr<Args extends Expr.Expr<any>[] = Expr.Expr<any>[], Return = unknown> extends Expr.Expr<Return> {
  readonly tag: "call-expr"
  readonly callee: Expr.Expr<any>
  readonly args: Args
  readonly type?: Type.TypeExpr<any> | undefined
}

type DenotesOf<Args extends Expr.Expr<any>[]> = { [K in keyof Args]: Expr.Denotes<Args[K]> }

type CheckCallArgs<Args extends Expr.Expr<any>[], Sig> =
    Sig extends (...args: infer P) => any ?
      DenotesOf<Args> extends P ? unknown
    : ["arguments do not match", P, DenotesOf<Args>]
  : ["callee is not callable — did you forget Instantiate?", Sig]

export const Call = <const Args extends Expr.Expr<any>[], Sig>(
  callee: Expr.Expr<Sig>,
  ...args: Args & CheckCallArgs<Args, NoInfer<Sig>>
): CallExpr<Args, Sig extends (...args: any[]) => infer R ? R : never> =>
  makePipeable({ tag: "call-expr", callee, args: args as unknown as Args, type: callType(callee) })

type ExprsOf<Params extends unknown[]> = { [K in keyof Params]: Expr.Expr<Params[K]> }

export const MethodCall = <const O extends Expr.Expr<any>, const K extends string & keyof Expr.Denotes<O>, const Args extends Expr.Expr<any>[]>(
  object: O,
  key: K,
  ...args: Expr.Denotes<O>[K] extends (...args: infer P) => any ? Args & ExprsOf<P> : never
): CallExpr<Args, Expr.Denotes<O>[K] extends (...args: any[]) => infer R ? R : never> => Call(Expr.Prop(object, key), ...args as never) as never

export type InstantiateParams<Params extends AnyParams, TypeParams extends Type.AnyParams, TypeArgs extends Type.TypeExpr<any>[]> = {
  [K in keyof Params]: Params[K] extends Param<infer Name, infer A, infer Kind>
    ? Param<Name, Type.Substitute<A, TypeParams, Type.ArgTypes<TypeArgs>>, Kind>
    : never
}

export interface Instantiation<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyParams = Type.AnyParams,
  TypeArgs extends Type.TypeExpr<any>[] = Type.TypeExpr<any>[],
> extends CallableExpr<InstantiateParams<Params, TypeParams, TypeArgs>, Type.Substitute<Return, TypeParams, Type.ArgTypes<TypeArgs>>> {
  readonly tag: "instantiation"
  readonly callee: Expr.Expr<GenericSignature<Params, Return, TypeParams>>
  readonly typeArgs: TypeArgs
  readonly type?: Type.FunctionType | undefined
}

/** replaces type params by position in a type node */
const substitute = (type: Type.TypeExpr<any>, params: Type.AnyParams, args: Type.TypeExpr<any>[]): Type.TypeExpr<any> => {
  const node = type as Type.Any
  const sub = (child: Type.TypeExpr<any>): Type.TypeExpr<any> => substitute(child, params, args)
  switch (node.tag) {
    case "param": {
      const index = params.findIndex((param) => param.name === node.name)
      return index === -1 ? type : args[index] ?? type
    }
    case "object":
      return Type.Object(Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, sub(value)])))
    case "array":
      return Type.Array(sub(node.element))
    case "tuple":
      return Type.Tuple(...node.items.map(sub))
    case "union":
      return Type.Union(...node.members.map(sub) as [Type.TypeExpr<any>, Type.TypeExpr<any>, ...Type.TypeExpr<any>[]])
    case "function":
      return Type.Function(node.params.map(sub), sub(node.return))
    case "type-ref":
      return node.args === undefined ? type : makeTypeNode({ ...node, args: node.args.map(sub) })
    default:
      return type
  }
}

export const Instantiate = <Params extends AnyParams, Return, TypeParams extends Type.AnyParams, TypeArgs extends Type.TypeExpr<any>[]>(
  callee: Expr.Expr<GenericSignature<Params, Return, TypeParams>>,
  ...typeArgs: TypeArgs
): Instantiation<Params, Return, TypeParams, TypeArgs> => {
  const calleeType = callee.type as Type.Any | undefined
  const typeParams = (callee as { readonly typeParams?: Type.AnyParams }).typeParams ?? []
  const type = calleeType?.tag === "function"
    ? Type.Function(calleeType.params.map((param) => substitute(param, typeParams, typeArgs)), substitute(calleeType.return, typeParams, typeArgs))
    : undefined
  return makePipeable({ tag: "instantiation", callee, typeArgs, type })
}

export type FunctionImpl<Params extends AnyParams, Return> = (bindings: ParamBindings<Params>) => Generator<Statement, Expr.Expr<Return>, unknown>

/** a declaration carries `impl` until `Program.build` runs it and replaces it with `body` */
export interface FunctionDeclaration<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyParams = Type.AnyParams,
> extends ValueBinding {
  readonly tag: "function-declaration"
  readonly id: BindingId
  readonly nameHint: string
  readonly typeParams: TypeParams
  readonly params: Params
  readonly returnType?: Type.TypeExpr<Return> | undefined
  readonly type?: Type.FunctionType | undefined
  readonly impl?: FunctionImpl<Params, Return> | undefined
  readonly body?: Block | undefined
}

export class FunctionBuilder<Params extends AnyParams = [], Return = unknown, TypeParams extends Type.AnyParams = []> extends Builder {
  readonly spec: FunctionDeclaration<Params, Return, TypeParams>

  constructor(spec: FunctionDeclaration<Params, Return, TypeParams>) {
    super()
    this.spec = makeYieldable(spec)
  }

  *[Symbol.iterator](): Generator<FunctionDeclaration<Params, Return, TypeParams>, Ref<Params, Return, TypeParams>, unknown> {
    yield this.spec
    const { id, nameHint, params, returnType, typeParams } = this.spec
    const type = returnType === undefined ? undefined : signatureType(params, returnType)
    if (typeParams.length > 0) {
      return makePipeable({ tag: "generic-function-ref" as const, target: id, nameHint, type, typeParams }) as Ref<Params, Return, TypeParams>
    }
    return callable(makePipeable({ tag: "function-ref" as const, target: id, nameHint, type })) as Ref<Params, Return, TypeParams>
  }
}

export const Function = (nameHint: string): FunctionBuilder =>
  new FunctionBuilder({ tag: "function-declaration", id: freshBindingId(), nameHint, typeParams: [], params: [] })

export const TypeParams =
  <const NextTypeParams extends Type.AnyParams>(...typeParams: NextTypeParams) =>
  <Params extends AnyParams, Return, TypeParams extends Type.AnyParams>(
    builder: FunctionBuilder<Params, Return, TypeParams>,
  ): FunctionBuilder<Params, Return, NextTypeParams> =>
    new FunctionBuilder({ ...builder.spec, typeParams } as unknown as FunctionDeclaration<Params, Return, NextTypeParams>)

export const Params =
  <const NextParams extends AnyParams>(...params: NextParams) =>
  <Params extends AnyParams, Return, TypeParams extends Type.AnyParams>(
    builder: FunctionBuilder<Params, Return, TypeParams>,
  ): FunctionBuilder<NextParams, Return, TypeParams> =>
    new FunctionBuilder({ ...builder.spec, params } as unknown as FunctionDeclaration<NextParams, Return, TypeParams>)

export const Returns =
  <NextReturn>(returnType: Type.TypeExpr<NextReturn>) =>
  <Params extends AnyParams, CurrentReturn, TypeParams extends Type.AnyParams>(
    builder: FunctionBuilder<Params, CurrentReturn, TypeParams>,
  ): FunctionBuilder<Params, NextReturn, TypeParams> =>
    new FunctionBuilder({ ...builder.spec, returnType } as unknown as FunctionDeclaration<Params, NextReturn, TypeParams>)

type CheckEarlyReturns<Yields, Declared> = [ReturnValue<Yields>] extends [Declared] ? []
  : ["early returns", ReturnValue<Yields>, "do not satisfy the declared return type", Declared]

type ImplReturn<CurrentReturn, InferredReturn, Yields> = unknown extends CurrentReturn ? InferredReturn | ReturnValue<Yields> : CurrentReturn

export const Impl = <
  Params extends AnyParams,
  CurrentReturn,
  TypeParams extends Type.AnyParams,
  Yields extends Statement,
  InferredReturn extends (unknown extends CurrentReturn ? unknown : CurrentReturn),
>(
  implementation: (bindings: ParamBindings<Params>) => Generator<Yields, Expr.Expr<InferredReturn>, unknown>,
) =>
(
  builder: FunctionBuilder<Params, CurrentReturn, TypeParams>,
  ..._check: CheckEarlyReturns<Yields, CurrentReturn>
): FunctionBuilder<Params, ImplReturn<CurrentReturn, InferredReturn, Yields>, TypeParams> =>
  new FunctionBuilder(
    { ...builder.spec, impl: implementation } as unknown as FunctionDeclaration<
      Params,
      ImplReturn<CurrentReturn, InferredReturn, Yields>,
      TypeParams
    >,
  )

export interface Arrow<Params extends AnyParams = AnyParams, Return = unknown> extends Expr.Expr<(...args: PlainParams<Params>) => Return> {
  readonly tag: "arrow"
  readonly params: Params
  readonly body: Block
  readonly type?: Type.FunctionType | undefined
}

/** unlike a declaration, an arrow's body runs at construction */
export const Arrow = <const Params extends AnyParams, Yields extends Statement, Return>(
  params: Params,
  impl: (bindings: ParamBindings<Params>) => Generator<Yields, Expr.Expr<Return>, unknown>,
): Arrow<Params, Return | ReturnValue<Yields>> => {
  const body = materializeValue(() => impl(paramBindings(params)))
  const returns = returnType(body)
  return makePipeable({ tag: "arrow", params, body, type: returns === undefined ? undefined : signatureType(params, returns) })
}

/** every function-related expression node kind */
export type Any =
  | FunctionRef<AnyParams, any>
  | GenericFunctionRef<AnyParams, any, Type.AnyParams>
  | CallExpr<Expr.Expr<any>[], any>
  | Instantiation<AnyParams, any, Type.AnyParams, Type.TypeExpr<any>[]>
  | Arrow<AnyParams, any>
