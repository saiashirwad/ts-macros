import type { Type } from "../node.ts"
import type { AnyParam, AnyParams } from "./nodes.ts"

export type { Type }

/** the TypeScript type a type node denotes */
export type Denotes<T extends Type<any>> = T extends Type<infer A> ? A : never

export type ArgTypes<Args extends Type<any>[]> = {
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
  readonly cond: ConditionalWhole<Args[0], Args[1], Args[2], Args[3]>
  readonly mapped: ResolveMapped<Args[0], Args[1], Args[2] & string>
  readonly tmpl: TemplateFold<Args[0], Args[1]>
  readonly and: LogicalAnd<Args[0], Args[1]>
  readonly or: LogicalOr<Args[0], Args[1]>
}

export type OpName = keyof Operators<any>

declare const InferId: unique symbol

/** the denotation of `infer Name` inside a conditional's pattern */
export interface Infer<Name extends string = string> {
  readonly [InferId]: Name
}

type ResolveMapped<Source, Body, KName extends string> = { [Key in keyof Source]: SubstituteWith<Body, { readonly [K in KName]: Key }> } & {}

export type TemplateInterpolation = string | number | bigint | boolean | null | undefined

export type TemplateInterpolationError<Got> = ["template literal interpolation must be", TemplateInterpolation, "got", Got]

type TemplateFold<Parts, Exprs> =
    Parts extends readonly [] ? ""
  : Parts extends readonly [infer Head extends string, ...infer Tail extends string[]] ?
      Exprs extends readonly [infer E, ...infer Rest extends unknown[]] ?
        E extends TemplateInterpolation ? `${Head}${E}${TemplateFold<Tail, Rest>}`
      : never
    : Head
  : string

export type IsAny<X> = 0 extends 1 & X ? true : false

type Falsy = false | 0 | 0n | "" | null | undefined

type LogicalFalsy<X> =
    IsAny<X> extends true ? X
  : X extends Falsy ? X
  : boolean extends X ? false
  : string extends X ? ""
  : number extends X ? 0
  : bigint extends X ? 0n
  : never

type LogicalTruthy<X> =
    IsAny<X> extends true ? X
  : unknown extends X ? {}
  : X extends Falsy ? never
  : boolean extends X ? true
  : X

export type HasFalsy<X> = true extends (X extends any ? [LogicalFalsy<X>] extends [never] ? false : true : never) ? true : false
export type HasTruthy<X> = true extends (X extends any ? [LogicalTruthy<X>] extends [never] ? false : true : never) ? true : false

type LogicalAnd<L, R> =
    [L] extends [never] ? never
  : unknown extends L ? unknown
  : LogicalFalsy<L> | (HasTruthy<L> extends true ? R : never)
type LogicalOr<L, R> = [L] extends [never] ? never : LogicalTruthy<L> | (HasFalsy<L> extends true ? R : never)

/** a logical operator over a type that may still be symbolic */
export type LogicalDenote<Name extends "and" | "or", L, R> =
    Abstract<L> extends true ? Op<Name, [L, R]>
  : Abstract<R> extends true ? Op<Name, [L, R]>
  : Operators<[L, R]>[Name]

type AnyTrue<Flags> = true extends Flags ? true : false

/** true when `X` still contains a variable, a host generic over one, or an unreduced operator */
export type Abstract<X> = AbstractExcept<X, never>

/** like `Abstract`, but a variable named `Except` (a mapped type's own key) does not count */
export type AbstractExcept<X, Except extends string, Depth extends readonly unknown[] = []> =
    Depth extends { length: 8 } ? false
  : [X] extends [string | number | boolean | bigint | symbol | null | undefined] ?
      [Extract<X, Variable<any> | Generic<any, any> | Op<any, any>>] extends [never] ? false
    : true extends (X extends any ? AbstractMember<X, Except, [...Depth, 0]> : never) ? true
    : false
  : true extends (X extends any ? AbstractMember<X, Except, [...Depth, 0]> : never) ? true
  : false

type AbstractMember<X, Except extends string, Depth extends readonly unknown[]> =
    IsAny<X> extends true ? false
  : X extends Variable<Except> ? false
  : [X] extends [Variable<any> | Generic<any, any> | Op<any, any>] ? true
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
  : ConditionalWhole<C, P, T, E>

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

declare const CandidateId: unique symbol

type Candidate<Co = never, Contra = unknown> = {
  readonly [CandidateId]: [Co, Contra]
  readonly co: Co
  readonly contra: Contra
}

type MergeBindings<A, B> = {
  readonly [K in keyof A | keyof B]: K extends keyof A ? K extends keyof B ? MergeCandidate<A[K], B[K]> : A[K] : K extends keyof B ? B[K] : never
}

type MergeCandidate<A, B> =
    A extends Candidate<infer ACo, infer AContra> ?
      B extends Candidate<infer BCo, infer BContra> ? Candidate<ACo | BCo, AContra & BContra>
    : A & B
  : A & B

type Merge<A, B> =
    A extends Failed ? Failed
  : B extends Failed ? Failed
  : MergeBindings<A, B>

type MergeAll<Each> = true extends (Each extends any ? (Each extends Failed ? true : false) : never) ? Failed : MergeUnionCandidates<Each>

type CandidateCo<U> = U extends Candidate<infer Co, any> ? Co : never
type CandidateContra<U> = (U extends Candidate<any, infer Contra> ? (x: Contra) => void : never) extends (x: infer Contra) => void ? Contra : unknown

type CandidateNames<U> = U extends any ? keyof U : never

type CandidateAt<U, K extends PropertyKey> = U extends Record<K, infer X> ? X : never

type MergeUnionCandidates<U> = {
  readonly [K in CandidateNames<U>]: Candidate<CandidateCo<CandidateAt<U, K>>, CandidateContra<CandidateAt<U, K>>>
}

type BindFields<C, P, Contra extends boolean> = MergeAll<{ [K in keyof P]: K extends keyof C ? Bind<C[K], P[K], Contra> : Failed }[keyof P]>

type BindTuple<C extends unknown[], P extends unknown[], Contra extends boolean> =
    P extends [infer PH, ...infer PT] ?
      C extends [infer CH, ...infer CT] ? Merge<Bind<CH, PH, Contra>, BindTuple<CT, PT, Contra>>
    : Failed
  : Matched

type Flip<B extends boolean> = B extends true ? false : true

/** matches `C` against the pattern `P`, collecting infer candidates by variance */
type Bind<C, P, Contra extends boolean = false> =
    P extends Infer<infer Name> ? { readonly [K in Name]: Contra extends true ? Candidate<never, C> : Candidate<C> }
  : P extends Promise<infer PA> ?
      C extends Promise<infer CA> ? Bind<CA, PA, Contra>
    : Failed
  : P extends readonly [] ?
      C extends readonly [] ? Matched
    : Failed
  : P extends readonly [infer PH, ...infer PT] ?
      C extends readonly [infer CH, ...infer CT] ? Merge<Bind<CH, PH, Contra>, Bind<CT, PT, Contra>>
    : Failed
  : P extends readonly (infer PE)[] ?
      C extends readonly (infer CE)[] ? Bind<CE, PE, Contra>
    : Failed
  : P extends (...args: infer PA) => infer PR ?
      C extends (...args: infer CA) => infer CR ? Merge<BindTuple<CA, PA, Flip<Contra>>, Bind<CR, PR, Contra>>
    : Failed
  : P extends object ?
      C extends object ? BindFields<C, P, Contra>
    : Failed
  : C extends P ? Matched
  : Failed

type ResolveCandidate<X> = X extends Candidate<infer Co, infer Contra> ? ResolveVariance<Co, Contra> : X

type ResolveVariance<Co, Contra> =
    unknown extends Contra ? Co
  : [Co] extends [never] ? Contra
  : [Co] extends [Contra] ? Co
  : never

type ResolveCandidates<B> = { readonly [K in keyof B]: ResolveCandidate<B[K]> }

type ResolveBranch<Body, B, E> = Body extends Variable<infer Name> ? ResolveName<Name, B, E> : SubstituteWith<Body, ResolveCandidates<B>>

type ResolveName<Name extends string, B, E> =
    B extends infer X ?
      Name extends keyof X ? ResolveNameValue<X[Name], E>
    : Variable<Name>
  : never

type ResolveNameValue<X, E> = X extends { readonly co: infer Co; readonly contra: infer Contra } ? ResolveNameParts<[Co, Contra], E> : X

type ResolveNameParts<Parts, E> =
    Parts extends [infer Co, infer Contra] ?
      unknown extends Contra ? Co
    : [Co] extends [never] ? Contra
    : [Co] extends [Contra] ? Co
    : E
  : never

type Conditional<C, P, T, E> = ResolveMatch<Bind<C, P>, T, E>

type ResolveMatch<B, T, E> = [B] extends [Failed] ? E : ResolveBranch<T, B, E>

type ConditionalWhole<C, P, T, E> = [C] extends [P] ? ConditionalMember<C, P, T, E> : E

type ConditionalMember<C, P, T, E> = C extends any ? Conditional<C, P, T, E> : never

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
    IsAny<Body> extends true ? Body
  : Body extends Variable<infer Name> ?
      Name extends keyof B ? B[Name]
    : Body
  : Body extends Generic<infer GName, infer GArgs extends unknown[]> ? ReduceGeneric<GName, SubstituteEach<GArgs, B>>
  : Body extends Op<"cond", [Variable<infer Name>, infer P, infer T, infer E]> ?
      Name extends keyof B ? DistributeCond<B[Name], Name, P, T, E, B>
    : ReduceOp<"cond", SubstituteEach<[Variable<Name>, P, T, E], B>>
  : Body extends Op<infer OName, infer OArgs extends unknown[]> ? ReduceOp<OName, SubstituteEach<OArgs, B>>
  : Abstract<Body> extends false ? Body
  : Body extends (...args: infer FnArgs) => infer Result ? (...args: SubstituteEach<FnArgs, B>) => SubstituteWith<Result, B>
  : Body extends object ? { [K in keyof Body]: SubstituteWith<Body[K], B> }
  : Body

type Override<B, Name extends string, C> = { readonly [K in keyof B | Name]: K extends Name ? C : K extends keyof B ? B[K] : never }

type AnyConditional<P, T, E> =
    P extends readonly [unknown, ...unknown[]] ? T
  : P extends (...args: any[]) => any ? T
  : T | E

type SubstituteAnyInfer<Body, B> =
    Body extends Variable<infer Name> ?
      Name extends keyof B ? B[Name]
    : unknown
  : SubstituteWith<Body, B>

/** a conditional on a type parameter is evaluated once per member of the union the parameter is bound to */
type DistributeCond<C, Name extends string, P, T, E, B> =
    IsAny<C> extends true ? AnyConditional<P, SubstituteAnyInfer<T, B>, SubstituteWith<E, B>>
  : C extends any ? Conditional<
    C,
    SubstituteWith<P, Override<B, Name, C>>,
    SubstituteWith<T, Override<B, Name, C>>,
    SubstituteWith<E, Override<B, Name, C>>
  >
  : never

/** replaces every `Variable` named by `Params` with the matching entry of `Args`, reducing operators that become concrete */
export type Substitute<Body, Params extends AnyParams, Args extends unknown[]> = SubstituteWith<Body, BindingsOf<Params, Args>>

export type ArityError<Expected, Got> = ["expected", Expected, "type args, got", Got]

export type ConstraintError<Name, Constraint, Got> = ["type argument for", Name, "must extend", Constraint, "got", Got]

export type CheckTypeArgs<Params extends AnyParams, TypeArgs extends Type<any>[]> = TypeArgs["length"] extends Params["length"]
  ? CheckTypeArgConstraints<Params, TypeArgs, Matched>
  : ArityError<Params["length"], TypeArgs["length"]>

type CheckTypeArgConstraints<Params extends AnyParams, TypeArgs extends Type<any>[], Bindings> =
    Params extends [infer Head extends AnyParam, ...infer Tail extends AnyParams] ?
      TypeArgs extends [infer Arg extends Type<any>, ...infer Rest extends Type<any>[]] ?
        SubstituteWith<Denotes<Head["extends"]>, Bindings> extends infer Constraint ?
          [Denotes<Arg>] extends [Constraint] ? CheckTypeArgConstraints<Tail, Rest, Bindings & { readonly [K in Head["name"]]: Denotes<Arg> }>
        : ConstraintError<Head["name"], Constraint, Denotes<Arg>>
      : never
    : never
  : []

export type Applied<Callee extends Type<any>, TypeArgs extends Type<any>[]> =
    Denotes<Callee> extends Fn<infer Params, infer Body> ?
      CheckTypeArgs<Params, TypeArgs> extends ArityError<any, any> | ConstraintError<any, any, any> ? CheckTypeArgs<Params, TypeArgs>
    : Substitute<Body, Params, ArgTypes<TypeArgs>>
  : Denotes<Callee>
