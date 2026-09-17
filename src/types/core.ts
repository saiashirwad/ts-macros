import type { TypeNode } from "../node.ts"
import type { AnyParam, AnyParams } from "./nodes.ts"

declare const TypeExprTypeId: unique symbol

/** a type node; `A` is the TypeScript type it denotes */
export interface TypeExpr<A = unknown> extends TypeNode {
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

/**
 * A host generic applied to arguments that may still contain variables. A
 * promise has no structure a mapped type could substitute through, so its
 * application is held like this and becomes `Promise<A>` once `A` is concrete.
 */
export interface Generic<Name extends GenericName, Args extends unknown[]> {
  readonly [GenericTypeId]: [Name, Args]
}

/** the host generics the type system can apply; `Array` is not one, because `Type.Array` is a node with structure */
export interface Generics<Args extends unknown[]> {
  readonly Promise: Promise<Args[0]>
}

export type GenericName = keyof Generics<any>

/** the denotation of a generic type declaration: a body abstracted over params */
export interface Fn<Params extends AnyParams = AnyParams, Body = unknown> {
  readonly params: Params
  readonly body: Body
}

export type Declared<Params extends AnyParams, Body> = Params extends [] ? Body : Fn<Params, Body>

// Symbolic type operators.
//
// A type operator applied to a type that still contains variables cannot be
// evaluated by TypeScript yet, so its denotation is kept as an `Op` and
// reduced by `Substitute` once the variables are replaced.

declare const OpTypeId: unique symbol

export interface Op<Name extends OpName, Args extends unknown[] = unknown[]> {
  readonly [OpTypeId]: [Name, Args]
}

export interface Operators<Args extends unknown[]> {
  readonly index: Args[0][Args[1] & keyof Args[0]]
  readonly keyof: keyof Args[0]
  readonly cond: Conditional<Args[0], Args[1], Args[2], Args[3]>
  readonly mapped: ResolveMapped<Args[0], Args[1], Args[2] & string>
  readonly tmpl: TemplateFold<Args[0], Args[1]>
}

export type OpName = keyof Operators<any>

declare const InferId: unique symbol

/** the denotation of `infer Name` inside a conditional's pattern */
export interface Infer<Name extends string = string> {
  readonly [InferId]: Name
}

type ResolveMapped<Source, Body, KName extends string> = { [Key in keyof Source]: SubstituteWith<Body, { readonly [K in KName]: Key }> }

type TemplateFold<Parts, Exprs> =
    Parts extends readonly [] ? ""
  : Parts extends readonly [infer Head extends string, ...infer Tail extends string[]] ?
      Exprs extends readonly [infer E, ...infer Rest extends unknown[]] ? `${Head}${E & (string | number | boolean)}${TemplateFold<Tail, Rest>}`
    : Head
  : string

type IsAny<X> = 0 extends 1 & X ? true : false

type AnyTrue<Flags> = true extends Flags ? true : false

/** true when `X` still contains a variable, a host generic over one, or an unreduced operator */
export type Abstract<X> = AbstractExcept<X, never>

/** like `Abstract`, but a variable named `Except` (a mapped type's own key) does not count */
export type AbstractExcept<X, Except extends string, Depth extends readonly unknown[] = []> =
    Depth extends { length: 8 } ? false
  : true extends (X extends any ? AbstractMember<X, Except, [...Depth, 0]> : never) ? true
  : false

type AbstractMember<X, Except extends string, Depth extends readonly unknown[]> =
    IsAny<X> extends true ? false
  : X extends Variable<Except> ? false
  : [X] extends [Variable<any>] ? true
  : [X] extends [Generic<any, any>] ? true
  : [X] extends [Op<any, any>] ? true
  : [X] extends [Infer<any>] ? false
  : [X] extends [string | number | boolean | bigint | symbol | null | undefined] ? false
  : [X] extends [Promise<infer A>] ? AbstractExcept<A, Except, Depth>
  : X extends (...args: infer FnArgs) => infer Result ? AnyTrue<AbstractExcept<FnArgs, Except, Depth> | AbstractExcept<Result, Except, Depth>>
  : [X] extends [readonly unknown[]] ? AnyTrue<{ [K in keyof X]: AbstractExcept<X[K], Except, Depth> }[number]>
  : [X] extends [object] ? AnyTrue<{ [K in keyof X]: AbstractExcept<X[K], Except, Depth> }[keyof X]>
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
  : Conditional<C, P, T, E>

export type MappedDenote<Source, Body, KName extends string> =
    Abstract<Source> extends true ? Op<"mapped", [Source, Body, KName]>
  : AbstractExcept<Body, KName> extends true ? Op<"mapped", [Source, Body, KName]>
  : ResolveMapped<Source, Body, KName>

export type TmplDenote<Parts extends readonly string[], Exprs extends readonly unknown[]> = Abstract<Exprs> extends true ? Op<"tmpl", [Parts, Exprs]>
  : TemplateFold<Parts, Exprs>

// Conditional types.
//
// `C extends P ? T : E` is evaluated by matching `C` against the pattern `P`.
// Every `Infer` in the pattern binds the corresponding part of `C`, and the
// bindings are substituted into `T`. When the check is a type parameter the
// conditional distributes over the union it is instantiated with, as in
// TypeScript; see `SubstituteWith`.

declare const FailedId: unique symbol

interface Failed {
  readonly [FailedId]: true
}

/** bindings collected while matching; `object` when the match bound nothing */
type Matched = object

type Merge<A, B> =
    A extends Failed ? Failed
  : B extends Failed ? Failed
  : A & B

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never

type MergeAll<Each> = true extends (Each extends any ? (Each extends Failed ? true : false) : never) ? Failed : UnionToIntersection<Each>

type BindFields<C, P> = MergeAll<{ [K in keyof P]: K extends keyof C ? Bind<C[K], P[K]> : Failed }[keyof P]>

/** matches `C` against the pattern `P`, binding every `Infer` in `P` */
type Bind<C, P> =
    P extends Infer<infer Name> ? { readonly [K in Name]: C }
  : P extends Promise<infer PA> ?
      C extends Promise<infer CA> ? Bind<CA, PA>
    : Failed
  : P extends readonly [] ?
      C extends readonly [] ? Matched
    : Failed
  : P extends readonly [infer PH, ...infer PT] ?
      C extends readonly [infer CH, ...infer CT] ? Merge<Bind<CH, PH>, Bind<CT, PT>>
    : Failed
  : P extends readonly (infer PE)[] ?
      C extends readonly (infer CE)[] ? Bind<CE, PE>
    : Failed
  : P extends (...args: infer PA) => infer PR ?
      C extends (...args: infer CA) => infer CR ? Merge<Bind<CA, PA>, Bind<CR, PR>>
    : Failed
  : P extends object ?
      C extends object ? BindFields<C, P>
    : Failed
  : C extends P ? Matched
  : Failed

type Conditional<C, P, T, E> =
    Bind<C, P> extends infer B ?
      B extends Failed ? E
    : SubstituteWith<T, B>
  : never

// Substitution.

type BindingsOf<Params extends AnyParams, Args extends unknown[]> =
    Params extends [infer Head extends AnyParam, ...infer Tail extends AnyParams] ?
      Args extends [infer Arg, ...infer Rest extends unknown[]] ? { readonly [K in Head["name"]]: Arg } & BindingsOf<Tail, Rest>
    : Matched
  : Matched

type SubstituteEach<Items extends unknown[], B> = Items extends [infer Head, ...infer Tail extends unknown[]]
  ? [SubstituteWith<Head, B>, ...SubstituteEach<Tail, B>]
  : []

// a mapped type's body and a conditional's branches may mention variables the
// operator itself binds, so only the operands that must be concrete are checked
type Stuck<Name extends OpName, Args extends unknown[]> =
    Name extends "mapped" ? Abstract<Args[0]>
  : Name extends "cond" ? AnyTrue<Abstract<Args[0]> | Abstract<Args[1]>>
  : Abstract<Args>

/** like `ReduceOp`: a generic whose arguments are still abstract stays symbolic */
type ReduceGeneric<Name extends GenericName, Args extends unknown[]> = Abstract<Args> extends true ? Generic<Name, Args> : Generics<Args>[Name]

type ReduceOp<Name extends OpName, Args extends unknown[]> = Stuck<Name, Args> extends true ? Op<Name, Args> : Operators<Args>[Name]

/** replaces every `Variable` named in the bindings `B`, reducing operators that become concrete */
type SubstituteWith<Body, B> =
    Abstract<Body> extends false ? Body
  : Body extends Variable<infer Name> ?
      Name extends keyof B ? B[Name]
    : Body
  : Body extends Generic<infer GName, infer GArgs extends unknown[]> ? ReduceGeneric<GName, SubstituteEach<GArgs, B>>
  : Body extends Op<"cond", [Variable<infer Name>, infer P, infer T, infer E]> ?
      Name extends keyof B ? DistributeCond<B[Name], Name, P, T, E, B>
    : ReduceOp<"cond", SubstituteEach<[Variable<Name>, P, T, E], B>>
  : Body extends Op<infer OName, infer OArgs extends unknown[]> ? ReduceOp<OName, SubstituteEach<OArgs, B>>
  : Body extends (...args: infer FnArgs) => infer Result ? (...args: SubstituteEach<FnArgs, B>) => SubstituteWith<Result, B>
  : Body extends object ? { [K in keyof Body]: SubstituteWith<Body[K], B> }
  : Body

type Override<B, Name extends string, C> = { readonly [K in keyof B | Name]: K extends Name ? C : K extends keyof B ? B[K] : never }

/** a conditional on a type parameter is evaluated once per member of the union the parameter is bound to */
type DistributeCond<C, Name extends string, P, T, E, B> = C extends any
  ? ReduceOp<"cond", SubstituteEach<[Variable<Name>, P, T, E], Override<B, Name, C>>>
  : never

/** replaces every `Variable` named by `Params` with the matching entry of `Args`, reducing operators that become concrete */
export type Substitute<Body, Params extends AnyParams, Args extends unknown[]> = SubstituteWith<Body, BindingsOf<Params, Args>>

type ArityError<Expected, Got> = ["expected", Expected, "type args, got", Got]

export type Applied<Callee extends TypeExpr<any>, TypeArgs extends TypeExpr<any>[]> =
    Denotes<Callee> extends Fn<infer Params, infer Body> ?
      TypeArgs["length"] extends Params["length"] ? Substitute<Body, Params, ArgTypes<TypeArgs>>
    : ArityError<Params["length"], TypeArgs["length"]>
  : Denotes<Callee>
