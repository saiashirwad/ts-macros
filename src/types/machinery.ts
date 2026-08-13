import type { AnyParam, AnyParams, ArgTypes, Denotes, Fn, Generic, Generics, Param, TypeExpr, Variable } from "./core.ts"

declare const OpTypeId: unique symbol

export interface Op<Name extends OpName, Args extends unknown[] = unknown[]> {
  readonly [OpTypeId]: [Name, Args]
}

export interface Operators<Args extends unknown[]> {
  readonly index: Args[0][Args[1] & keyof Args[0]]
  readonly keyof: keyof Args[0]
  readonly cond: Args[0] extends Args[1] ? Args[2] : Args[3]
  readonly mapped: ResolveMapped<Args[0], Args[1], Args[2] & string>
  readonly tmpl: TemplateFold<Args[0], Args[1]>
}

export type OpName = keyof Operators<any>

type ResolveMapped<Source, Body, KName extends string> = { [Key in keyof Source]: Substitute<Body, [Param<KName, any>], [Key]> }

type TemplateFold<Parts, Exprs> =
    Parts extends readonly [] ? ""
  : Parts extends readonly [infer Head extends string, ...infer Tail extends string[]] ?
      Exprs extends readonly [infer E, ...infer Rest extends unknown[]] ? `${Head}${E & (string | number | boolean)}${TemplateFold<Tail, Rest>}`
    : Head
  : string

export type Abstract<X, Depth extends readonly unknown[] = []> =
    Depth extends { length: 8 } ? false
  : true extends (X extends any ? AbstractMember<X, Depth> : never) ? true
  : false

type AbstractMember<X, Depth extends readonly unknown[]> =
    [X] extends [Variable<any>] ? true
  : [X] extends [Generic<any, any>] ? true
  : [X] extends [Op<any, any>] ? true
  : [X] extends [string | number | boolean | bigint | symbol | null | undefined] ? false
  : [X] extends [readonly (infer E)[]] ? Abstract<E, [...Depth, 0]>
  : [X] extends [object] ? Abstract<X[keyof X], [...Depth, 0]>
  : false

export type AbstractExcept<X, Name extends string, Depth extends readonly unknown[] = []> =
    Depth extends { length: 8 } ? false
  : true extends (X extends any ? AbstractExceptMember<X, Name, Depth> : never) ? true
  : false

type AbstractExceptMember<X, Name extends string, Depth extends readonly unknown[]> =
    X extends Variable<Name> ? false
  : [X] extends [Variable<any>] ? true
  : [X] extends [Generic<any, any>] ? true
  : [X] extends [Op<any, any>] ? true
  : [X] extends [string | number | boolean | bigint | symbol | null | undefined] ? false
  : [X] extends [readonly (infer E)[]] ? AbstractExcept<E, Name, [...Depth, 0]>
  : [X] extends [object] ? AbstractExcept<X[keyof X], Name, [...Depth, 0]>
  : false

export type IndexDenote<O, K> =
    Abstract<O> extends true ? Op<"index", [O, K]>
  : Abstract<K> extends true ? Op<"index", [O, K]>
  : [K] extends [keyof O] ? O[K]
  : Op<"index", [O, K]>

export type KeyOfDenote<T> = Abstract<T> extends true ? Op<"keyof", [T]> : keyof T

export type CondDenote<C, P, T, E> =
    Abstract<C> extends true ? Op<"cond", [C, P, T, E]>
  : Abstract<P> extends true ? Op<"cond", [C, P, T, E]>
  : C extends P ? T
  : E

export type MappedDenote<Source, Body, KName extends string> =
    Abstract<Source> extends true ? Op<"mapped", [Source, Body, KName]>
  : AbstractExcept<Body, KName> extends true ? Op<"mapped", [Source, Body, KName]>
  : ResolveMapped<Source, Body, KName>

export type TmplDenote<Parts extends readonly string[], Exprs extends readonly unknown[]> = Abstract<Exprs> extends true ? Op<"tmpl", [Parts, Exprs]>
  : TemplateFold<Parts, Exprs>

type ResolveVariable<
  Params extends AnyParams,
  Args extends unknown[],
  Name extends string,
> =
    Params extends [infer Head extends AnyParam, ...infer Tail extends AnyParams] ?
      Args extends [infer Arg, ...infer Rest extends unknown[]] ?
        Head["name"] extends Name ? Arg
      : ResolveVariable<Tail, Rest, Name>
    : Variable<Name>
  : Variable<Name>

type SubstituteEach<
  Items extends unknown[],
  Params extends AnyParams,
  Args extends unknown[],
> = Items extends [infer Head, ...infer Tail extends unknown[]] ? [Substitute<Head, Params, Args>, ...SubstituteEach<Tail, Params, Args>] : []

type ReduceOp<Name extends OpName, Args extends unknown[]> =
    Name extends "mapped" ?
      Abstract<Args[0]> extends true ? Op<Name, Args>
    : Operators<Args>[Name]
  : Abstract<Args> extends true ? Op<Name, Args>
  : Operators<Args>[Name]

export type Substitute<Body, Params extends AnyParams, Args extends unknown[]> =
    Body extends Variable<infer Name> ? ResolveVariable<Params, Args, Name>
  : Body extends Generic<infer GName, infer GArgs extends unknown[]> ? Generics<SubstituteEach<GArgs, Params, Args>>[GName]
  : Body extends Op<infer OName, infer OArgs extends unknown[]> ? ReduceOp<OName, SubstituteEach<OArgs, Params, Args>>
  : Body extends (...args: infer FnArgs) => infer Result ? (...args: SubstituteEach<FnArgs, Params, Args>) => Substitute<Result, Params, Args>
  : Body extends object ? { [K in keyof Body]: Substitute<Body[K], Params, Args> }
  : Body

type ArityError<Expected, Got> = ["expected", Expected, "type args, got", Got]

export type Apply<Callee extends TypeExpr<any>, TypeArgs extends TypeExpr<any>[]> =
    Denotes<Callee> extends Fn<infer Params, infer Body> ?
      TypeArgs["length"] extends Params["length"] ? Substitute<Body, Params, ArgTypes<TypeArgs>>
    : ArityError<Params["length"], TypeArgs["length"]>
  : Denotes<Callee>
