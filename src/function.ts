import * as Expr from "./expr.ts"
import { type BindingId, freshBindingId, type ValueBinding, type ValueReference } from "./identity.ts"
import { Builder, makeNode, makeStatement } from "./node.ts"
import { type Block, materializeValue, type NonLoopStatement, type ReturnValue } from "./statement.ts"
import * as Type from "./types/index.ts"
import { blockReturnType, callType, type ParamBindingType, paramBindingType, signatureType, substitute, type WidenReturn } from "./types/lattice.ts"

export type ParamKind = "required" | "optional" | "rest"

/** a rest param is declared by its element type: `Rest("tags", Type.String())` is `...tags: string[]` */
export interface Param<Name extends string = string, A = unknown, Kind extends ParamKind = "required"> extends ValueBinding {
  readonly tag: "param"
  readonly id: BindingId
  readonly nameHint: Name
  readonly type: Type.TypeExpr<A>
  readonly kind: Kind
}

export type AnyParam = Param<string, any, ParamKind>
export type AnyParams = AnyParam[]

const param = <Name extends string, A, Kind extends ParamKind>(kind: Kind, nameHint: Name, type: Type.TypeExpr<A>): Param<Name, A, Kind> =>
  makeNode({ tag: "param", id: freshBindingId(), nameHint, type, kind })

export const Param = <const Name extends string, A>(nameHint: Name, type: Type.TypeExpr<A>): Param<Name, A> => param("required", nameHint, type)

export const Optional = <const Name extends string, A>(nameHint: Name, type: Type.TypeExpr<A>): Param<Name, A, "optional"> =>
  param("optional", nameHint, type)

export const Rest = <const Name extends string, A>(nameHint: Name, type: Type.TypeExpr<A>): Param<Name, A, "rest"> => param("rest", nameHint, type)

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
  readonly [P in Params[number] as P["nameHint"]]: P extends Param<any, infer A, infer Kind> ? Expr.VarRef<ParamBindingType<A, Kind>> : never
}

export const paramBindings = <Params extends AnyParams>(params: Params): ParamBindings<Params> =>
  Object.fromEntries(
    params.map((param) => [param.nameHint, Expr.VarRef(param.id, param.nameHint, paramBindingType(param), true, false)]),
  ) as unknown as ParamBindings<
    Params
  >

/** an expression denoting a function with these params */
export type CallableExpr<Params extends AnyParams = AnyParams, Return = unknown> = Expr.Expr<(...args: PlainParams<Params>) => Return>

export interface FunctionRef<Params extends AnyParams = AnyParams, Return = unknown> extends CallableExpr<Params, Return>, ValueReference {
  readonly tag: "function-ref"
  readonly target: BindingId
  readonly nameHint: string
  readonly type?: Type.FunctionType | undefined
  readonly typeParams: []
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
  readonly tag: "function-ref"
  readonly target: BindingId
  readonly nameHint: string
  readonly type?: Type.FunctionType | undefined
  readonly typeParams: TypeParams
}

/** the ref a function declaration hands back: a generic one has to be instantiated before it can be called */
export type Ref<Params extends AnyParams, Return, TypeParams extends Type.AnyParams> = TypeParams extends [] ? FunctionRef<Params, Return>
  : GenericFunctionRef<Params, Return, TypeParams>

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
  makeNode({ tag: "call-expr", callee, args: args as unknown as Args, type: callType(callee) })

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
  readonly callee: GenericFunctionRef<Params, Return, TypeParams>
  readonly typeArgs: TypeArgs
  readonly type?: Type.FunctionType | undefined
}

type CheckTypeArgs<TypeParams extends Type.AnyParams, TypeArgs extends Type.TypeExpr<any>[]> =
    Type.CheckTypeArgs<TypeParams, TypeArgs> extends infer Check ?
      Check extends Type.ArityError<any, any> | Type.ConstraintError<any, any, any> ? [Check]
    : TypeArgs
  : never

export const Instantiate = <Params extends AnyParams, Return, TypeParams extends Type.AnyParams, TypeArgs extends Type.TypeExpr<any>[]>(
  callee: GenericFunctionRef<Params, Return, TypeParams>,
  ...typeArgs: CheckTypeArgs<TypeParams, TypeArgs>
): Instantiation<Params, Return, TypeParams, TypeArgs> => {
  const type = callee.type === undefined ? undefined : substitute(callee.type, callee.typeParams, typeArgs) as Type.FunctionType
  return makeNode({ tag: "instantiation", callee, typeArgs, type })
}

export type FunctionImpl<Params extends AnyParams, Return> = (
  bindings: ParamBindings<Params>,
) => Generator<NonLoopStatement, Expr.Expr<Return>, unknown>

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

// A declaration is built in two stages. `Function(name)` is a draft: it takes
// `TypeParams`, `Params` and `Returns`, and it cannot be yielded. `Impl` ends
// the draft, checking the body against what was declared, and hands back the
// builder that can be yielded and takes nothing more.

export class FunctionDraft<Params extends AnyParams = [], Return = unknown, TypeParams extends Type.AnyParams = []> extends Builder {
  declare readonly stage: "draft"
  /** makes the draft invariant, so an `Impl` built for one signature is never accepted for another */
  declare readonly exactly: (params: Params, returns: Return, typeParams: TypeParams) => [Params, Return, TypeParams]
  readonly declaration: FunctionDeclaration<Params, Return, TypeParams>

  constructor(declaration: FunctionDeclaration<Params, Return, TypeParams>) {
    super()
    this.declaration = declaration
  }
}

export class FunctionBuilder<Params extends AnyParams = [], Return = unknown, TypeParams extends Type.AnyParams = []> extends Builder {
  declare readonly stage: "implemented"
  readonly declaration: FunctionDeclaration<Params, Return, TypeParams>

  constructor(declaration: FunctionDeclaration<Params, Return, TypeParams>) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<FunctionDeclaration<Params, Return, TypeParams>, Ref<Params, Return, TypeParams>, unknown> {
    yield makeStatement(this.declaration)
    const { id, nameHint, params, returnType, typeParams } = this.declaration
    return makeNode({ tag: "function-ref" as const, target: id, nameHint, type: signatureType(params, returnType), typeParams }) as Ref<
      Params,
      Return,
      TypeParams
    >
  }
}

export const Function = (nameHint: string): FunctionDraft =>
  new FunctionDraft({ tag: "function-declaration", id: freshBindingId(), nameHint, typeParams: [], params: [] })

export const TypeParams =
  <const NextTypeParams extends Type.AnyParams>(...typeParams: NextTypeParams) =>
  <Params extends AnyParams, Return, TypeParams extends Type.AnyParams>(
    draft: FunctionDraft<Params, Return, TypeParams> & Type.CheckTypeParamNames<NextTypeParams>,
  ): FunctionDraft<Params, Return, NextTypeParams> =>
    new FunctionDraft({ ...draft.declaration, typeParams } as unknown as FunctionDeclaration<Params, Return, NextTypeParams>)

/** a parameter list TypeScript accepts: nothing required after an optional, and a rest only at the end */
type CheckParams<Params extends AnyParams, SeenOptional extends boolean = false> =
    Params extends [infer Head extends AnyParam, ...infer Tail extends AnyParams] ?
      Head["kind"] extends "rest" ?
        Tail extends [] ? unknown
      : ["a rest parameter must be last", Head["nameHint"]]
    : Head["kind"] extends "optional" ? CheckParams<Tail, true>
    : SeenOptional extends true ? ["a required parameter cannot follow an optional one", Head["nameHint"]]
    : CheckParams<Tail, false>
  : unknown

export const Params =
  <const NextParams extends AnyParams>(...params: NextParams & CheckParams<NextParams>) =>
  <Params extends AnyParams, Return, TypeParams extends Type.AnyParams>(
    draft: FunctionDraft<Params, Return, TypeParams>,
  ): FunctionDraft<NextParams, Return, TypeParams> =>
    new FunctionDraft({ ...draft.declaration, params } as unknown as FunctionDeclaration<NextParams, Return, TypeParams>)

export const Returns =
  <NextReturn>(returnType: Type.TypeExpr<NextReturn>) =>
  <Params extends AnyParams, CurrentReturn, TypeParams extends Type.AnyParams>(
    draft: FunctionDraft<Params, CurrentReturn, TypeParams>,
  ): FunctionDraft<Params, NextReturn, TypeParams> =>
    new FunctionDraft({ ...draft.declaration, returnType } as unknown as FunctionDeclaration<Params, NextReturn, TypeParams>)

// an intersection on the draft rather than a `..._check` rest parameter; see `CheckInit` in binding.ts
type CheckEarlyReturns<Yields, Declared> = [Expr.Denotes<ReturnValue<Yields>>] extends [Declared] ? unknown
  : ["early returns", Expr.Denotes<ReturnValue<Yields>>, "do not satisfy the declared return type", Declared]

/** the declared return type, or else what the returned expressions infer to */
type ImplReturn<Declared, Final, Yields> = unknown extends Declared ? WidenReturn<Final | ReturnValue<Yields>> : Declared

export const Impl = <
  Params extends AnyParams,
  Declared,
  TypeParams extends Type.AnyParams,
  Yields extends NonLoopStatement,
  Final extends Expr.Expr<unknown extends Declared ? any : Declared>,
>(
  implementation: (bindings: ParamBindings<Params>) => Generator<Yields, Final, unknown>,
) =>
(
  draft: FunctionDraft<Params, Declared, TypeParams> & CheckEarlyReturns<Yields, Declared>,
): FunctionBuilder<Params, ImplReturn<Declared, Final, Yields>, TypeParams> =>
  new FunctionBuilder(
    { ...draft.declaration, impl: implementation } as unknown as FunctionDeclaration<Params, ImplReturn<Declared, Final, Yields>, TypeParams>,
  )

export interface Arrow<Params extends AnyParams = AnyParams, Return = unknown> extends CallableExpr<Params, Return> {
  readonly tag: "arrow"
  readonly params: Params
  readonly body: Block
  readonly type?: Type.FunctionType | undefined
}

/** unlike a declaration, an arrow's body runs at construction */
export const Arrow = <const Params extends AnyParams, Yields extends NonLoopStatement, Final extends Expr.Expr<any>>(
  params: Params,
  impl: (bindings: ParamBindings<Params>) => Generator<Yields, Final, unknown>,
): Arrow<Params, WidenReturn<Final | ReturnValue<Yields>>> => {
  const body = materializeValue(() => impl(paramBindings(params)))
  return makeNode({ tag: "arrow", params, body, type: signatureType(params, blockReturnType(body)) })
}

/** every function-related expression node kind */
export type Any =
  | FunctionRef<AnyParams, any>
  | GenericFunctionRef<AnyParams, any, Type.AnyParams>
  | CallExpr<Expr.Expr<any>[], any>
  | Instantiation<AnyParams, any, Type.AnyParams, Type.TypeExpr<any>[]>
  | Arrow<AnyParams, any>
