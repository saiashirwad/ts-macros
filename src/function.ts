import { inferReturns } from "./emit/returns.ts"
import * as Expr from "./expr.ts"
import { type BindingId, freshBindingId, type ValueBinding, type ValueReference } from "./identity.ts"
import { AstNodePrototype, makePipeable, makeYieldable, PipeableClass } from "./pipeable.ts"
import type { ExpressionScopeHandlers, StatementScopeHandlers } from "./scope/protocol.ts"
import { type Block, materializeValue, type ReturnValue, type Statement } from "./statement.ts"
import { norm, type SurfaceMembers } from "./sugar/norm.ts"
import { expr } from "./sugar/surface.ts"
import * as Type from "./types/index.ts"

export type ParamKind = "required" | "optional" | "rest"

export interface Param<
  Name extends string = string,
  A = unknown,
  Kind extends ParamKind = "required",
> extends ValueBinding {
  readonly tag: "param"
  readonly id: BindingId
  readonly nameHint: Name
  readonly type: Type.TypeExpr<A>
  readonly kind?: Kind
}

export type AnyParam = Param<string, any, any>
export type AnyParams = AnyParam[]

export const Param = <const Name extends string, A>(
  nameHint: Name,
  type: Type.TypeExpr<A>,
): Param<Name, A> => makePipeable({ tag: "param", id: freshBindingId(), nameHint, type })

export const Optional = <const Name extends string, A>(
  nameHint: Name,
  type: Type.TypeExpr<A>,
): Param<Name, A, "optional"> => makePipeable({ tag: "param", id: freshBindingId(), nameHint, type, kind: "optional" })

export const Rest = <const Name extends string, A>(
  nameHint: Name,
  type: Type.TypeExpr<A>,
): Param<Name, A, "rest"> => makePipeable({ tag: "param", id: freshBindingId(), nameHint, type, kind: "rest" })

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
  readonly [P in Params[number] as P["nameHint"]]: P extends Param<any, infer A, infer Kind>
    ? Expr.VarRef<Kind extends "rest" ? A[] : Kind extends "optional" ? A | undefined : A>
    : never
}

type ExprsOf<Params extends unknown[]> = { [K in keyof Params]: Expr.Expr<Params[K]> }

export const paramBindings = <Params extends AnyParams>(params: Params): ParamBindings<Params> =>
  Object.fromEntries(
    params.map((param) => [param.nameHint, Expr.LocalRef(param.id, param.nameHint, param.type)]),
  ) as unknown as ParamBindings<Params>

export interface FunctionRef<
  Params extends AnyParams = AnyParams,
  Return = unknown,
> extends Expr.Expr<(...args: PlainParams<Params>) => Return>, ValueReference {
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

export type DeclaredRef<
  Params extends AnyParams = AnyParams,
  Return = unknown,
> = FunctionRef<Params, Return> & SurfaceMembers<(...args: PlainParams<Params>) => Return>

/** the ref a function declaration hands back: callable unless the function is generic */
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
  readonly type?: Type.TypeExpr<any> | undefined
}

type CheckCallable<Sig> = Sig extends (...args: any[]) => any ? [] : ["callee is not callable — did you forget Instantiate?", Sig]

export const Call = <const Args extends Expr.Expr<any>[], Sig>(
  callee: Expr.Expr<Sig>,
  ...args: [
    ...(Sig extends (...args: infer P) => any ? Args & ExprsOf<P> : Args),
    ...CheckCallable<Sig>,
  ]
): CallExpr<Args, Sig extends (...args: any[]) => infer R ? R : never> => {
  const calleeType = callee.type as Type.FunctionType | undefined
  const type = calleeType?.tag === "function" ? calleeType.return : undefined
  return makePipeable({
    tag: "call-expr",
    callee,
    args: args as unknown as Args,
    type,
  })
}

export const MethodCall = <
  const O extends Expr.Expr<any>,
  const K extends string & keyof Expr.Denotes<O>,
  const Args extends Expr.Expr<any>[],
>(
  object: O,
  key: K,
  ...args: Expr.Denotes<O>[K] extends (...args: infer P) => any ? Args & ExprsOf<P> : never
): CallExpr<Args, Expr.Denotes<O>[K] extends (...args: any[]) => infer R ? R : never> =>
  (() => {
    const callee = Expr.Prop(object, key)
    const calleeType = callee.type as Type.FunctionType | undefined
    return makePipeable({
      tag: "call-expr",
      callee,
      args,
      type: calleeType?.tag === "function" ? calleeType.return : undefined,
    })
  })()

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
  readonly type?: Type.FunctionType | undefined
}

const substituteType = (
  type: Type.TypeExpr<any>,
  params: Type.AnyParams,
  args: Type.TypeExpr<any>[],
): Type.TypeExpr<any> => {
  const node = type as Type.Any
  switch (node.tag) {
    case "param": {
      const index = params.findIndex((param) => param.name === node.name)
      return index === -1 ? type : args[index] ?? type
    }
    case "object":
      return Type.Object(Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, substituteType(value, params, args)])))
    case "array":
      return Type.Array(substituteType(node.element, params, args))
    case "tuple":
      return Type.Tuple(...node.items.map((item) => substituteType(item, params, args)))
    case "union":
      return Type.Union(
        ...node.members.map((member: Type.TypeExpr<any>) => substituteType(member, params, args)) as [
          Type.TypeExpr<any>,
          Type.TypeExpr<any>,
          ...Type.TypeExpr<any>[],
        ],
      )
    case "function":
      return Type.Function(
        node.params.map((param) => substituteType(param, params, args)),
        substituteType(node.return, params, args),
      )
    case "type-ref":
      return node.args === undefined
        ? type
        : Type.Ref(node.name, ...node.args.map((arg) => substituteType(arg, params, args)))
    case "application":
      return Type.Apply(
        node.callee,
        node.args.map((arg) => substituteType(arg, params, args)),
      )
    default:
      return type
  }
}

export const Instantiate = <
  Params extends AnyParams,
  Return,
  TypeParams extends Type.AnyParams,
  TypeArgs extends Type.TypeExpr<any>[],
>(
  callee: Expr.Expr<GenericSignature<Params, Return, TypeParams>>,
  ...typeArgs: TypeArgs
): Instantiation<Params, Return, TypeParams, TypeArgs> => {
  const calleeType = callee.type as Type.FunctionType | undefined
  const generic = callee as Expr.Expr<any> & { readonly typeParams?: Type.AnyParams }
  const typeParams = generic.typeParams ?? []
  const type = calleeType?.tag === "function"
    ? Type.Function(
      calleeType.params.map((param) => substituteType(param, typeParams, typeArgs)),
      substituteType(calleeType.return, typeParams, typeArgs),
    )
    : undefined
  return makePipeable({ tag: "instantiation", callee, typeArgs, type })
}

export type FunctionImpl<Params extends AnyParams, Return> = (
  bindings: ParamBindings<Params>,
) => Generator<Statement, Expr.Expr<Return>, unknown>

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

export class FunctionBuilder<
  Params extends AnyParams = [],
  Return = unknown,
  TypeParams extends Type.AnyParams = [],
> extends PipeableClass() {
  readonly spec: FunctionDeclaration<Params, Return, TypeParams>

  constructor(spec: FunctionDeclaration<Params, Return, TypeParams>) {
    super()
    this.spec = makeYieldable(spec)
  }

  withSpec<
    NextParams extends AnyParams = Params,
    NextReturn = Return,
    NextTypeParams extends Type.AnyParams = TypeParams,
  >(
    spec: FunctionDeclaration<NextParams, NextReturn, NextTypeParams>,
  ): FunctionBuilder<NextParams, NextReturn, NextTypeParams> {
    return new FunctionBuilder(spec)
  }

  *[Symbol.iterator](): Generator<
    FunctionDeclaration<Params, Return, TypeParams>,
    Ref<Params, Return, TypeParams>,
    unknown
  > {
    yield this.spec
    const fnType = this.spec.returnType !== undefined
      ? Type.Function(this.spec.params.map((p: AnyParam) => p.type), this.spec.returnType)
      : undefined
    if (this.spec.typeParams.length === 0) {
      const callable: any = (...args: any[]) => expr(Call(callable, ...args.map(norm) as any))
      Object.defineProperty(callable, "name", {
        value: this.spec.nameHint,
        configurable: true,
        writable: true,
      })
      Object.setPrototypeOf(callable, AstNodePrototype)
      return Object.assign(callable, {
        tag: "function-ref" as const,
        target: this.spec.id,
        nameHint: this.spec.nameHint,
        type: fnType,
      }) as Ref<Params, Return, TypeParams>
    }
    return makePipeable({
      tag: "generic-function-ref" as const,
      target: this.spec.id,
      nameHint: this.spec.nameHint,
      type: fnType,
      typeParams: this.spec.typeParams,
    }) as Ref<Params, Return, TypeParams>
  }
}

export const Function = (nameHint: string): FunctionBuilder =>
  new FunctionBuilder({ tag: "function-declaration", id: freshBindingId(), nameHint, typeParams: [], params: [] })

export const TypeParams =
  <const NextTypeParams extends Type.AnyParams>(...typeParams: NextTypeParams) =>
  <Params extends AnyParams, Return, TypeParams extends Type.AnyParams>(
    builder: FunctionBuilder<Params, Return, TypeParams>,
  ): FunctionBuilder<Params, Return, NextTypeParams> =>
    new FunctionBuilder({
      ...builder.spec,
      typeParams,
    } as unknown as FunctionDeclaration<Params, Return, NextTypeParams>)

export const Params =
  <const NextParams extends AnyParams>(...params: NextParams) =>
  <Params extends AnyParams, Return, TypeParams extends Type.AnyParams>(
    builder: FunctionBuilder<Params, Return, TypeParams>,
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
      type: Type.Function(builder.spec.params.map((p: AnyParam) => p.type), returnType),
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

export interface Arrow<Params extends AnyParams = AnyParams, Return = unknown> extends
  Expr.Expr<
    (...args: PlainParams<Params>) => Return
  >
{
  readonly tag: "arrow"
  readonly params: Params
  readonly body: Block
  readonly type?: Type.FunctionType | undefined
}

export const Arrow = <const Params extends AnyParams, Yields extends Statement, Return>(
  params: Params,
  impl: (bindings: ParamBindings<Params>) => Generator<Yields, Expr.Expr<Return>, unknown>,
): Arrow<Params, Return | ReturnValue<Yields>> => {
  const body = materializeValue(() => impl(paramBindings(params)))
  const returnType = inferReturns(body, (value) => value.type)
  const type = returnType !== undefined ? Type.Function(params.map((p) => p.type), returnType) : undefined
  return makePipeable({
    tag: "arrow",
    params,
    body,
    type,
  })
}

/** every function-domain expr node kind, instantiated so the emitter can switch exhaustively */
export type Any =
  | FunctionRef<AnyParams, any>
  | GenericFunctionRef<AnyParams, any, Type.AnyParams>
  | CallExpr<Expr.Expr<any>[], any>
  | Instantiation<AnyParams, any, Type.AnyParams, Type.TypeExpr<any>[]>
  | Arrow<AnyParams, any>

export const functionExpressionScopeHandlers = {
  "function-ref": (node, cursor) => cursor.reference(node),
  "generic-function-ref": (node, cursor) => cursor.reference(node),
  "call-expr": (node, cursor) => {
    cursor.expression(node.callee)
    node.args.forEach((argument) => cursor.expression(argument))
  },
  instantiation: (node, cursor) => cursor.expression(node.callee),
  arrow: (node, cursor) => cursor.childScope(node.body.statements, node.params),
} satisfies ExpressionScopeHandlers<Any>

export const functionStatementScopeHandlers = {
  "function-declaration": {
    bindings: (node) => [node],
    visit: (node, cursor) => {
      if (node.body !== undefined) cursor.childScope(node.body.statements, node.params)
    },
  },
} satisfies StatementScopeHandlers<FunctionDeclaration<any, any, any>>
