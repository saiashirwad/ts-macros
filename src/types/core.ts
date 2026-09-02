import { makeTypeNode, type Pipeable } from "../pipeable.ts"

declare const TypeExprTypeId: unique symbol

/** a type node; `A` is the TypeScript type it denotes */
export interface TypeExpr<A = unknown> extends Pipeable {
  readonly [TypeExprTypeId]?: A
}

export type Denotes<T extends TypeExpr<any>> = T extends TypeExpr<infer A> ? A : never

export type ArgTypes<Args extends TypeExpr<any>[]> = {
  [K in keyof Args]: Denotes<Args[K]>
}

declare const TypeVariableId: unique symbol

/** the denotation of a type parameter before it is substituted */
export interface Variable<Name extends string = string> {
  readonly [TypeVariableId]: Name
}

declare const GenericTypeId: unique symbol

/** a host generic (`Array`, `Promise`, ...) applied to arguments that may still contain variables */
export interface Generic<Name extends GenericName, Args extends unknown[]> {
  readonly [GenericTypeId]?: [Name, Args]
}

export interface Generics<Args extends unknown[]> {
  readonly Array: Array<Args[0]>
  readonly ReadonlyArray: ReadonlyArray<Args[0]>
  readonly Promise: Promise<Args[0]>
  readonly Set: Set<Args[0]>
  readonly Map: Map<Args[0], Args[1]>
  readonly Record: Record<Args[0] & PropertyKey, Args[1]>
}

export type GenericName = keyof Generics<any>

export interface Param<
  Name extends string,
  Extends extends TypeExpr = TypeExpr<unknown>,
  A = Variable<Name> & Denotes<Extends>,
> extends TypeExpr<A> {
  readonly tag: "param"
  readonly name: Name
  readonly extends?: Extends | undefined
}

export type AnyParam = Param<string, any, any>
export type AnyParams = AnyParam[]

export const Param = <const Name extends string, Extends extends TypeExpr = TypeExpr<unknown>>(
  name: Name,
  _extends?: Extends,
): Param<Name, Extends> => makeTypeNode({ tag: "param", name, extends: _extends })

/** the denotation of a generic type declaration: a body abstracted over params */
export interface Fn<Params extends AnyParams = AnyParams, Body = unknown> {
  readonly params: Params
  readonly body: Body
}

export type Declared<Params extends AnyParams, Body> = Params extends [] ? Body : Fn<Params, Body>

type ResolveVariable<Params extends AnyParams, Args extends unknown[], Name extends string> =
    Params extends [infer Head extends AnyParam, ...infer Tail extends AnyParams] ?
      Args extends [infer Arg, ...infer Rest extends unknown[]] ?
        Head["name"] extends Name ? Arg
      : ResolveVariable<Tail, Rest, Name>
    : Variable<Name>
  : Variable<Name>

type SubstituteEach<Items extends unknown[], Params extends AnyParams, Args extends unknown[]> = Items extends
  [infer Head, ...infer Tail extends unknown[]] ? [Substitute<Head, Params, Args>, ...SubstituteEach<Tail, Params, Args>] : []

/** replaces every `Variable` named by `Params` with the matching entry of `Args` */
export type Substitute<Body, Params extends AnyParams, Args extends unknown[]> =
    Body extends Variable<infer Name> ? ResolveVariable<Params, Args, Name>
  : Body extends Generic<infer GName, infer GArgs extends unknown[]> ? Generics<SubstituteEach<GArgs, Params, Args>>[GName]
  : Body extends (...args: infer FnArgs) => infer Result ? (...args: SubstituteEach<FnArgs, Params, Args>) => Substitute<Result, Params, Args>
  : Body extends object ? { [K in keyof Body]: Substitute<Body[K], Params, Args> }
  : Body

type ArityError<Expected, Got> = ["expected", Expected, "type args, got", Got]

export type Applied<Callee extends TypeExpr<any>, TypeArgs extends TypeExpr<any>[]> =
    Denotes<Callee> extends Fn<infer Params, infer Body> ?
      TypeArgs["length"] extends Params["length"] ? Substitute<Body, Params, ArgTypes<TypeArgs>>
    : ArityError<Params["length"], TypeArgs["length"]>
  : Denotes<Callee>
