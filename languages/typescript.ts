import {
  addConstruct,
  type AnyNode,
  type ArgumentsAccepted,
  type Assignable,
  type Binding,
  binding,
  type BindingId,
  type Block,
  braces,
  builder,
  type Check,
  children,
  defineTarget,
  type Denotes,
  emit,
  type Equal,
  type Expr,
  expr,
  exprClass,
  type Facts,
  type FactsOf,
  type Fields,
  frag,
  type Fragment,
  functionConstruct,
  type FunctionResult,
  type Kind,
  type KindsOf,
  lessConstruct,
  type Narrowing,
  type NodeClass,
  type Param,
  type ParamRefs,
  type Program,
  type Ref,
  type Rejected,
  scope,
  type Signature,
  type Stmt,
  stmt,
  stmtClass,
  structured,
  typeClass,
  type TypeLambda,
  type TypeNode,
  typeNode,
} from "../src/lang/index.ts"
import type {
  AssignNode,
  BinaryNode,
  CallNode,
  ExpressionNode,
  FunctionNode,
  IfNode,
  LetNode,
  RefNode,
  ReturnNode,
  WhileNode,
} from "../src/lang/index.ts"

export interface TsTruthy extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer T] ? (Equal<T, void> extends true ? false : true) : false
}

export interface TsSum extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B]
    ? [A, B] extends [number, number] ? number
    : [A, B] extends [bigint, bigint] ? bigint
    : [A, B] extends [string, string | number | bigint | boolean] | [string | number | bigint | boolean, string] ? string
    : never
    : never
}

export interface TsCompare extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B]
    ? [A, B] extends [number, number] | [bigint, bigint] | [string, string] ? boolean : never
    : never
}

export interface TsAssign extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer From, infer To]
    ? Kind<Assignable, [From extends Signature<infer P, infer R> ? (...args: P) => R : From, To]>
    : false
}

export interface TS {
  readonly name: "typescript"
  readonly Assign: TsAssign
  readonly Truthy: TsTruthy
  readonly Sum: TsSum
  readonly Compare: TsCompare
}

declare const MeaningOf: unique symbol

export interface TsType<M extends TypeLambda, F extends Facts = Facts> extends TypeNode<TS, Evaluate<M>, F> {
  readonly [MeaningOf]: M
}

export type Evaluate<M extends TypeLambda, Env = {}> = Kind<M, [Env]>

export interface Const<D> extends TypeLambda {
  readonly type: D
}

export type MeaningOf<N> = N extends { readonly [MeaningOf]: infer M extends TypeLambda } ? M : Const<Denotes<N>>

type AnyType = TypeNode<TS, any, any>
type Env<Args> = Args extends readonly [infer E] ? E : {}
type Meanings<T extends readonly AnyType[]> = { readonly [K in keyof T]: MeaningOf<T[K]> }
type Evaluated<M extends readonly TypeLambda[], E> = { -readonly [K in keyof M]: Evaluate<M[K], E> }
type Intersected<T extends readonly unknown[]> = T extends readonly [infer Head, ...infer Tail] ? Head & Intersected<Tail> : unknown

export interface ArrayMeaning<E extends TypeLambda> extends TypeLambda {
  readonly type: Evaluate<E, Env<this["Args"]>>[]
}

export interface ReadonlyArrayMeaning<E extends TypeLambda> extends TypeLambda {
  readonly type: readonly Evaluate<E, Env<this["Args"]>>[]
}

export interface FunctionMeaning<Params extends readonly TypeLambda[], Returns extends TypeLambda, Rest extends TypeLambda | undefined>
  extends TypeLambda
{
  readonly type: Rest extends TypeLambda ? (
      ...args: [...Evaluated<Params, Env<this["Args"]>>, ...Extract<Evaluate<Rest, Env<this["Args"]>>, readonly unknown[]>]
    ) => Evaluate<Returns, Env<this["Args"]>>
    : (...args: Evaluated<Params, Env<this["Args"]>>) => Evaluate<Returns, Env<this["Args"]>>
}

export interface UnionMeaning<M extends readonly TypeLambda[]> extends TypeLambda {
  readonly type: Evaluate<M[number], Env<this["Args"]>>
}

export interface IntersectionMeaning<M extends readonly TypeLambda[]> extends TypeLambda {
  readonly type: Intersected<Evaluated<M, Env<this["Args"]>>>
}

interface ElementMeaning {
  readonly m: TypeLambda
  readonly element: "required" | "optional" | "spread"
}

type Elements<M extends readonly ElementMeaning[], E> =
    M extends readonly [infer Head extends ElementMeaning, ...infer Tail extends readonly ElementMeaning[]] ?
      Head["element"] extends "spread" ? [...Extract<Evaluate<Head["m"], E>, readonly unknown[]>, ...Elements<Tail, E>]
    : Head["element"] extends "optional" ? [Evaluate<Head["m"], E>?, ...Elements<Tail, E>]
    : [Evaluate<Head["m"], E>, ...Elements<Tail, E>]
  : []

export interface TupleMeaning<M extends readonly ElementMeaning[]> extends TypeLambda {
  readonly type: Elements<M, Env<this["Args"]>>
}

export interface Spread<T extends AnyType = AnyType> {
  readonly spread: T
}

type ElementInput = AnyType | Field<AnyType, false, true> | Spread
type ElementMeanings<T extends readonly ElementInput[]> = {
  readonly [K in keyof T]: T[K] extends Spread<infer S> ? { readonly m: MeaningOf<S>; readonly element: "spread" }
    : T[K] extends Field<infer O, any, any> ? { readonly m: MeaningOf<O>; readonly element: "optional" }
    : { readonly m: MeaningOf<T[K]>; readonly element: "required" }
}
type ElementType<X> =
    X extends Spread<infer S> ? S
  : X extends Field<infer O, any, any> ? O
  : X
type RequiredAfterOptional<T extends readonly ElementInput[], Seen extends boolean = false> =
    T extends readonly [infer Head, ...infer Tail extends readonly ElementInput[]] ?
      Head extends Spread ? RequiredAfterOptional<Tail, Seen>
    : Head extends Field ? RequiredAfterOptional<Tail, true>
    : Seen extends true ? true
    : RequiredAfterOptional<Tail, Seen>
  : false

export interface Field<T extends AnyType = AnyType, R extends boolean = boolean, O extends boolean = boolean> {
  readonly type: T
  readonly readonly: R
  readonly optional: O
}

type FieldInput = AnyType | Field
type FieldOf<X extends FieldInput> =
    X extends Field<infer T, infer R, infer O> ? Field<T, R, O>
  : X extends AnyType ? Field<X, false, false>
  : never
type FieldMeaning<X extends FieldInput> = FieldOf<X> extends Field<infer T, infer R, infer O>
  ? { readonly m: MeaningOf<T>; readonly r: R; readonly o: O }
  : never

interface FieldMeanings {
  readonly [key: string]: { readonly m: TypeLambda; readonly r: boolean; readonly o: boolean }
}

type Modified<Fs extends FieldMeanings, E> =
  & { readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [true, true] ? K : never]?: Evaluate<Fs[K]["m"], E> }
  & { readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [true, false] ? K : never]: Evaluate<Fs[K]["m"], E> }
  & { -readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [false, true] ? K : never]?: Evaluate<Fs[K]["m"], E> }
  & { -readonly [K in keyof Fs as [Fs[K]["r"], Fs[K]["o"]] extends [false, false] ? K : never]: Evaluate<Fs[K]["m"], E> }

type Flat<T> = { [K in keyof T]: T[K] } & {}

export interface ObjectMeaning<Fs extends FieldMeanings> extends TypeLambda {
  readonly type: Flat<Modified<Fs, Env<this["Args"]>>>
}

type Interpolable = string | number | bigint | boolean | null | undefined

type TemplateText<Parts extends readonly unknown[], E> =
    Parts extends readonly [infer Head, ...infer Tail] ?
      Head extends string ? `${Head}${TemplateText<Tail, E>}`
    : Head extends TypeLambda ? `${Extract<Evaluate<Head, E>, Interpolable>}${TemplateText<Tail, E>}`
    : never
  : ""

export interface TemplateMeaning<Parts extends readonly unknown[]> extends TypeLambda {
  readonly type: TemplateText<Parts, Env<this["Args"]>>
}

type TemplatePart = string | TypeNode<TS, Interpolable, any>
type TemplateMeanings<Parts extends readonly TemplatePart[]> = {
  readonly [K in keyof Parts]: Parts[K] extends string ? Parts[K] : MeaningOf<Parts[K]>
}
type TemplateFacts<Parts extends readonly TemplatePart[]> = FactsOf<Exclude<Parts[number], string>>
type NonLiteralPart<Parts extends readonly TemplatePart[]> = {
  [K in keyof Parts]: Parts[K] extends string ? (string extends Parts[K] ? Parts[K] : never) : never
}[number]

type LiteralValue = string | number | bigint | boolean | null

export interface VarMeaning<Key extends string, Fallback extends TypeLambda> extends TypeLambda {
  readonly variable: Key
  readonly type: Env<this["Args"]> extends { readonly [K in Key]: infer V } ? V : Evaluate<Fallback, Env<this["Args"]>>
}

type Bind<E, Key extends string, V> = Omit<E, Key> & { readonly [K in Key]: V }

type Inferring<E, Names extends readonly string[], A, B, C, D> =
  & Omit<E, Names[number]>
  & { readonly [K in Names[0]]: A }
  & { readonly [K in Names[1]]: B }
  & { readonly [K in Names[2]]: C }
  & { readonly [K in Names[3]]: D }

type IsAny<X> = 0 extends 1 & X ? true : false

interface Infers {
  readonly names: readonly string[]
  readonly constraints: readonly unknown[]
}

type NoInfers = { readonly names: []; readonly constraints: [] }

type Matched<X, P extends TypeLambda, T extends TypeLambda, E, I extends Infers> = [X] extends [
  Evaluate<
    P,
    Inferring<
      E,
      I["names"],
      infer A extends I["constraints"][0],
      infer B extends I["constraints"][1],
      infer C extends I["constraints"][2],
      infer D extends I["constraints"][3]
    >
  >,
] ? [Evaluate<T, Inferring<E, I["names"], A, B, C, D>>]
  : never

type Whole<X, P extends TypeLambda, T extends TypeLambda, F extends TypeLambda, E, I extends Infers> =
    IsAny<X> extends true ? Matched<X, P, T, E, I>[0] | (unknown extends Evaluate<P, E> ? never : Evaluate<F, E>)
  : [Matched<X, P, T, E, I>] extends [never] ? Evaluate<F, E>
  : Matched<X, P, T, E, I>[0]

type Distributed<X, Key extends string, P extends TypeLambda, T extends TypeLambda, F extends TypeLambda, E, I extends Infers> = X extends unknown
  ? Whole<X, P, T, F, Bind<E, Key, X>, I>
  : never

export interface ConditionalMeaning<
  Key extends string,
  C extends TypeLambda,
  P extends TypeLambda,
  T extends TypeLambda,
  F extends TypeLambda,
  I extends Infers,
> extends TypeLambda {
  readonly type: [Key] extends [never] ? Whole<Evaluate<C, Env<this["Args"]>>, P, T, F, Env<this["Args"]>, I>
    : Distributed<Evaluate<C, Env<this["Args"]>>, Key, P, T, F, Env<this["Args"]>, I>
}

type VariableOf<N> = MeaningOf<N> extends VarMeaning<infer Key, any> ? Key : never

type InferVar<Name extends string, Q, Kind extends string> = TsType<VarMeaning<Name, Const<Q>>, { readonly kind: Kind }>

type InferSpec = string | readonly [string, AnyType]
type InferSpecs =
  | readonly [InferSpec]
  | readonly [InferSpec, InferSpec]
  | readonly [InferSpec, InferSpec, InferSpec]
  | readonly [InferSpec, InferSpec, InferSpec, InferSpec]
type InfersOf<S extends InferSpecs> = {
  readonly names: { readonly [K in keyof S]: S[K] extends readonly [infer Name extends string, AnyType] ? Name : Extract<S[K], string> }
  readonly constraints: { readonly [K in keyof S]: S[K] extends readonly [string, infer T] ? Denotes<T> : unknown }
}
type InferConstraintFacts<S extends InferSpecs> = FactsOf<Extract<S[number], readonly [string, AnyType]>[1]>

export type InferBody<I extends Infers, Kind extends string> = <
  Q1 extends I["constraints"][0],
  Q2 extends I["constraints"][1],
  Q3 extends I["constraints"][2],
  Q4 extends I["constraints"][3],
>(
  first: InferVar<I["names"][0], Q1, Kind>,
  second: InferVar<I["names"][1], Q2, Kind>,
  third: InferVar<I["names"][2], Q3, Kind>,
  fourth: InferVar<I["names"][3], Q4, Kind>,
) => AnyType

type Returned<B> = B extends (...args: any) => infer R ? R : never

export interface KeyofMeaning<M extends TypeLambda> extends TypeLambda {
  readonly keyof: M
  readonly type: keyof Evaluate<M, Env<this["Args"]>>
}

type Modifier = "+" | "-" | undefined

export interface MappedModifiers<R extends Modifier, O extends Modifier, A> {
  readonly readonly?: R
  readonly optional?: O
  readonly as?: A
}

type ReadonlyModified<T, R extends Modifier> =
    R extends "+" ? Readonly<T>
  : R extends "-" ? { -readonly [K in keyof T]: T[K] }
  : T
type OptionalModified<T, O extends Modifier> =
    O extends "+" ? Partial<T>
  : O extends "-" ? Required<T>
  : T

type Homomorphic<S, Variable extends string, Name extends string, Body extends TypeLambda, E> = {
  [K in keyof S]: Evaluate<Body, Bind<Bind<E, Variable, S>, Name, K>>
}
type HomomorphicAs<S, Variable extends string, Name extends string, As extends TypeLambda, Body extends TypeLambda, E> = {
  [K in keyof S as Extract<Evaluate<As, Bind<Bind<E, Variable, S>, Name, K>>, PropertyKey>]: Evaluate<Body, Bind<Bind<E, Variable, S>, Name, K>>
}
type OverKeysOf<S extends readonly [unknown], Name extends string, Body extends TypeLambda, E> = {
  [K in keyof S[0]]: Evaluate<Body, Bind<E, Name, K>>
}
type OverKeysOfAs<S extends readonly [unknown], Name extends string, As extends TypeLambda, Body extends TypeLambda, E> = {
  [K in keyof S[0] as Extract<Evaluate<As, Bind<E, Name, K>>, PropertyKey>]: Evaluate<Body, Bind<E, Name, K>>
}
type OverKeys<Keys extends PropertyKey, Name extends string, Body extends TypeLambda, E> = { [K in Keys]: Evaluate<Body, Bind<E, Name, K>> }
type OverKeysAs<Keys extends PropertyKey, Name extends string, As extends TypeLambda, Body extends TypeLambda, E> = {
  [K in Keys as Extract<Evaluate<As, Bind<E, Name, K>>, PropertyKey>]: Evaluate<Body, Bind<E, Name, K>>
}

type Mapped<Name extends string, Keys extends TypeLambda, Body extends TypeLambda, As extends TypeLambda | undefined, E> =
    Keys extends KeyofMeaning<infer S> ?
      S extends VarMeaning<infer Variable, any> ?
        As extends TypeLambda ? HomomorphicAs<Evaluate<S, E>, Variable, Name, As, Body, E>
      : Homomorphic<Evaluate<S, E>, Variable, Name, Body, E>
    : As extends TypeLambda ? OverKeysOfAs<[Evaluate<S, E>], Name, As, Body, E>
    : OverKeysOf<[Evaluate<S, E>], Name, Body, E>
  : As extends TypeLambda ? OverKeysAs<Evaluate<Keys, E> & PropertyKey, Name, As, Body, E>
  : OverKeys<Evaluate<Keys, E> & PropertyKey, Name, Body, E>

export interface MappedMeaning<
  Name extends string,
  Keys extends TypeLambda,
  Body extends TypeLambda,
  As extends TypeLambda | undefined,
  R extends Modifier,
  O extends Modifier,
> extends TypeLambda {
  readonly type: OptionalModified<ReadonlyModified<Mapped<Name, Keys, Body, As, Env<this["Args"]>>, R>, O>
}

type Remap<Name extends string, Keys extends AnyType, A> = Equal<A, MappedBody<Name, Denotes<Keys>>> extends true ? never : Returned<A>

export type MappedBody<Name extends string, Keys> = <Q extends Keys & PropertyKey>(key: TsType<VarMeaning<Name, Const<Q>>, ParamFacts>) => AnyType

export interface IndexMeaning<O extends TypeLambda, K extends TypeLambda> extends TypeLambda {
  readonly type: Evaluate<O, Env<this["Args"]>>[Evaluate<K, Env<this["Args"]>> & keyof Evaluate<O, Env<this["Args"]>>]
}

export interface TypeParam<C = unknown, F extends Facts = never> {
  readonly binding: Binding
  readonly constraint: TypeNode<TS, C, F> | undefined
}

type ParamFacts = { readonly kind: "type-param" }
type ParamRef<Key extends string, M extends TypeLambda> = TsType<VarMeaning<Key, M>, ParamFacts>
type ConstraintOf<P> = P extends TypeParam<infer C, any> ? C : unknown

export type AliasBody<N extends string, P extends readonly TypeParam<any, any>[]> = <
  M1 extends Const<ConstraintOf<P[0]>>,
  M2 extends Const<ConstraintOf<P[1]>>,
  M3 extends Const<ConstraintOf<P[2]>>,
  M4 extends Const<ConstraintOf<P[3]>>,
>(first: ParamRef<`${N}#0`, M1>, second: ParamRef<`${N}#1`, M2>, third: ParamRef<`${N}#2`, M3>, fourth: ParamRef<`${N}#3`, M4>) => AnyType

type ParamEnv<N extends string, Values extends readonly unknown[]> = { readonly [I in keyof Values & `${number}` as `${N}#${I}`]: Values[I] }

export interface ApplicationMeaning<N extends string, Body extends TypeLambda, Args extends readonly TypeLambda[]> extends TypeLambda {
  readonly type: Evaluate<Body, ParamEnv<N, Evaluated<Args, Env<this["Args"]>>>>
}

type Specific<F> = F extends { readonly kind: infer K } ? (string extends K ? never : F) : never
type Slots<P extends readonly TypeParam<any, any>[]> = { readonly [K in keyof P]: TypeNode<TS, ConstraintOf<P[K]>, any> }
type Application<N extends string, B, A extends readonly AnyType[]> = TsType<
  ApplicationMeaning<N, MeaningOf<Returned<B>>, Meanings<A>>,
  { readonly kind: "type-ref" } | FactsOf<A[number]>
>
type Applicator<N extends string, P extends readonly TypeParam<any, any>[], B> = P extends readonly [] ? Application<N, B, []>
  : <const A extends Slots<P>>(...args: A) => Application<N, B, A>
type AliasFacts<P extends readonly TypeParam<any, any>[], B> =
  | { readonly kind: "type-alias" | "type-param" }
  | FactsOf<P[number]["constraint"]>
  | Specific<FactsOf<Returned<B>>>
type AliasResult<N extends string, P extends readonly TypeParam<any, any>[], B extends (...args: any) => AnyType> = P["length"] extends
  Parameters<B>["length"] ? Stmt<TS, AliasFacts<P, B>, Applicator<N, P, B>>
  : Rejected<"the body does not take one argument per type parameter", { params: P["length"]; arguments: Parameters<B>["length"] }>

interface Tags {
  readonly string: string
  readonly number: number
  readonly bigint: bigint
  readonly boolean: boolean
  readonly symbol: symbol
  readonly undefined: undefined
  readonly object: object | null
  readonly function: Function
}

export type Tag = keyof Tags

type Callable = (...args: never) => unknown

type Overlap<M, T> = T extends unknown ? ([M] extends [T] ? M : [T] extends [M] ? T : never) : never

type TypeofMember<M, T extends Tag> =
    Equal<M, {}> extends true ? Exclude<Tags[T], null | undefined>
  : T extends "function" ? ([M] extends [Callable] ? M : [object] extends [M] ? Function : never)
  : T extends "object" ? ([M] extends [Callable] ? never : Overlap<M, object | null>)
  : Overlap<M, Tags[T]>

type TypeofOtherMember<M, T extends Tag> =
    Equal<M, {}> extends true ? M
  : [M] extends [Callable] ? (T extends "function" ? never : M)
  : T extends "function" ? M
  : [M] extends [Tags[T]] ? never
  : M

export type TypeofThen<D, T extends Tag> =
    IsAny<D> extends true ? (T extends "object" | "function" ? D : Tags[T])
  : unknown extends D ? Tags[T]
  : D extends unknown ? TypeofMember<D, T>
  : never

export type TypeofElse<D, T extends Tag> =
    IsAny<D> extends true ? D
  : unknown extends D ?
      T extends "undefined" ? {} | null
    : T extends "object" ? {} | undefined
    : unknown
  : D extends unknown ? TypeofOtherMember<D, T>
  : never

export type NonNullish<D> =
    IsAny<D> extends true ? D
  : unknown extends D ? {}
  : D extends null | undefined | void ? never
  : D

export type Nullish<D> =
    IsAny<D> extends true ? D
  : unknown extends D ? null | undefined
  : D extends null | undefined | void ? D
  : never

type Subtype<A, B> =
    [A] extends [B] ?
      [A] extends [object] ? ([B] extends [object] ? ([keyof B] extends [keyof A] ? true : false) : true)
    : true
  : false

type Members<D, Check, Result> = D extends unknown ? (Subtype<D, Result> extends true ? D : Subtype<Check, D> extends true ? Result : never) : never

export type NarrowedTo<D, Check, Result> =
    IsAny<D> extends true ? Result
  : [Members<D, Check, Result>] extends [never] ?
      [Result] extends [D] ? Result
    : [D] extends [Result] ? D
    : D & Result
  : Members<D, Check, Result>

export type Excluded<D, Result> =
    IsAny<D> extends true ? D
  : D extends unknown ? (Subtype<D, Result> extends true ? never : D)
  : never

type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never
type IsUnit<V> =
    [V] extends [never] ? false
  : true extends IsUnion<V> ? false
  : [V] extends [null | undefined | boolean] ? true
  : [V] extends [string] ? ({} extends Record<V & string, 0> ? false : true)
  : [V] extends [number] ? ({} extends Record<V & number, 0> ? false : true)
  : [V] extends [bigint] ? (bigint extends V ? false : true)
  : [V] extends [symbol] ? (symbol extends V ? false : true)
  : false

type Comparable<A, B> = true extends
  (A extends unknown ? (B extends unknown ? ([A] extends [B] ? true : [B] extends [A] ? true : false) : never) : never) ? true : false

type Overlapping<A, B> =
    true extends IsAny<A> | IsAny<B> ? true
  : [A] extends [null | undefined] ? true
  : [B] extends [null | undefined] ? true
  : Comparable<A, B>

type EqualMember<M, V> =
    Equal<M, {}> extends true ? (V extends null | undefined ? never : V extends object ? object : V)
  : V extends unknown ? ([V] extends [M] ? V : [M] extends [V] ? M : never)
  : never

export type EqualThen<D, V> =
    IsAny<D> extends true ? D
  : unknown extends D ? (V extends object ? object : V)
  : D extends unknown ? EqualMember<D, V>
  : never

export type EqualElse<D, V> =
    IsAny<D> extends true ? D
  : IsUnit<V> extends false ? D
  : unknown extends D ? ([V] extends [null] ? {} | undefined : [V] extends [undefined] ? {} | null : unknown)
  : D extends unknown ? (Equal<D, V> extends true ? never : D)
  : never

type HasUnit<P> = true extends (P extends unknown ? IsUnit<P> : never) ? true : false
type Discriminant<D, K extends PropertyKey> = true extends (D extends unknown ? HasUnit<D[K & keyof D]> : never) ? true : false
type Discriminated<D, K extends PropertyKey, Narrowed> =
    Discriminant<D, K> extends false ? D
  : D extends unknown ? (Comparable<D[K & keyof D], Narrowed> extends true ? D : never)
  : never

type Value<D> = D extends Signature<infer P, infer R> ? (...args: P) => R : D

declare const AccessOf: unique symbol

export interface Access<S, K> {
  readonly [AccessOf]?: readonly [S, K]
}

type EqualityNarrowing<L, V> =
    L extends Ref<TS, infer D, infer Declared> ? Narrowing<EqualThen<Value<D>, V>, EqualElse<Value<D>, V>, Declared>
  : L extends Access<Ref<TS, infer D, infer Declared>, infer K extends PropertyKey> ? Narrowing<
    Discriminated<Value<D>, K, EqualThen<Value<D>[K & keyof Value<D>], V>>,
    Discriminated<Value<D>, K, EqualElse<Value<D>[K & keyof Value<D>], V>>,
    Declared
  >
  : unknown

type Equality<L, R, Negated extends boolean> =
  & Expr<TS, boolean, Extract<{ readonly kind: "equality" } | FactsOf<L> | FactsOf<R>, Facts>>
  & (Negated extends true ? Swapped<EqualityNarrowing<L, Denotes<R>>> : EqualityNarrowing<L, Denotes<R>>)

type Swapped<N> = N extends Narrowing<infer Then, infer Else, infer Declared> ? Narrowing<Else, Then, Declared> : unknown

declare const PredicateOf: unique symbol

export interface Predicate<I extends number, T> {
  readonly [PredicateOf]?: readonly [I, T]
}

type PredicateParts<R> = typeof PredicateOf extends keyof R ? (R extends { readonly [PredicateOf]?: infer P } ? Exclude<P, undefined> : never) : never

type PredicateFits<P extends readonly Param<TS, any, any>[], R> =
    [PredicateParts<R>] extends [never] ? true
  : PredicateParts<R> extends readonly [infer I extends number, infer T] ?
      [T] extends [Denotes<P[I]["type"]>] ? true
    : false
  : true

type DeclaredOf<S> = S extends Ref<TS, any, infer Declared> ? Declared : never

type Guard<Then, Else, S, K extends string> = Expr<TS, boolean, { readonly kind: K | "ref" }> & Narrowing<Then, Else, DeclaredOf<S>>

type Negated<E> = E extends Narrowing<infer Then, infer Else, infer Declared>
  ? Expr<TS, boolean, Extract<{ readonly kind: "not" } | FactsOf<E>, Facts>> & Narrowing<Else, Then, Declared>
  : Expr<TS, boolean, Extract<{ readonly kind: "not" } | FactsOf<E>, Facts>>

type Called<R, Args extends readonly unknown[], FC extends Facts> =
  & Expr<TS, R, Extract<{ readonly kind: "call" } | FC | FactsOf<Args[number]>, Facts>>
  & ([PredicateParts<R>] extends [never] ? unknown
    : PredicateParts<R> extends readonly [infer I extends number, infer T]
      ? Args[I] extends Ref<TS, infer D, infer Declared> ? Narrowing<NarrowedTo<Value<D>, T, T>, Excluded<Value<D>, T>, Declared> : unknown
    : unknown)

export interface PrimitiveTypeNode {
  readonly kind: "primitive-type"
  readonly name: "number" | "string" | "boolean" | "bigint" | "symbol" | "void" | "null" | "undefined" | "unknown" | "never" | "any" | "object"
}
export interface ArrayTypeNode {
  readonly kind: "array-type"
  readonly element: AnyNode
  readonly readonly: boolean
}
export interface LiteralTypeNode {
  readonly kind: "literal-type"
  readonly value: LiteralValue
}
export interface ObjectTypeNode {
  readonly kind: "object-type"
  readonly fields: ReadonlyArray<{ readonly key: string } & Field>
}
export interface FunctionTypeNode {
  readonly kind: "function-type"
  readonly params: ReadonlyArray<AnyNode>
  readonly rest: AnyNode | undefined
  readonly returns: AnyNode
}
export interface MembersTypeNode {
  readonly kind: "union-type" | "intersection-type"
  readonly members: ReadonlyArray<AnyNode>
}
export interface TupleTypeNode {
  readonly kind: "tuple-type"
  readonly elements: ReadonlyArray<{ readonly type: AnyNode; readonly element: ElementMeaning["element"] }>
}
export interface TemplateTypeNode {
  readonly kind: "template-type"
  readonly parts: ReadonlyArray<string | AnyNode>
}
export interface ConditionalTypeNode {
  readonly kind: "conditional-type"
  readonly check: AnyNode
  readonly infers: ReadonlyArray<Binding>
  readonly branch: Block
  readonly otherwise: AnyNode
}
export interface MappedTypeNode {
  readonly kind: "mapped-type"
  readonly key: Binding
  readonly keys: AnyNode
  readonly scope: Block
  readonly readonly: Modifier
  readonly optional: Modifier
}
export interface KeyofTypeNode {
  readonly kind: "keyof-type"
  readonly operand: AnyNode
}
export interface IndexTypeNode {
  readonly kind: "index-type"
  readonly object: AnyNode
  readonly index: AnyNode
}
export interface TypeAliasNode {
  readonly kind: "type-alias"
  readonly binding: Binding
  readonly params: ReadonlyArray<TypeParam<unknown, Facts>>
  readonly body: Block
}
export interface TypeRefNode {
  readonly kind: "type-ref" | "type-param"
  readonly binding: Binding
  readonly args: ReadonlyArray<AnyNode>
}
export interface InferTypeNode {
  readonly kind: "infer-type"
  readonly binding: Binding
  readonly constraint: AnyNode | undefined
}
export interface GuardNode {
  readonly kind: "typeof-guard" | "nullish-guard" | "array-guard"
  readonly subject: AnyNode
  readonly narrows: Binding
  readonly tag: string
}
export interface NotNode {
  readonly kind: "not"
  readonly operand: AnyNode
  readonly narrows: Binding | undefined
}
export interface PredicateTypeNode {
  readonly kind: "type-predicate"
  readonly index: number
  readonly type: AnyNode
}
export interface GetNode {
  readonly kind: "get"
  readonly object: AnyNode
  readonly key: string | number
}
export interface EqualityNode {
  readonly kind: "equality"
  readonly operator: "===" | "!=="
  readonly left: AnyNode
  readonly right: AnyNode
  readonly narrows: Binding | undefined
}
export interface LiteralNode {
  readonly kind: "literal"
  readonly value: number | string | boolean | bigint | null
}

const primitiveClass = typeClass<PrimitiveTypeNode>()
const arrayClass = typeClass<ArrayTypeNode>({ children: (node) => [node.element] })
const literalTypeClass = typeClass<LiteralTypeNode>()
const objectClass = typeClass<ObjectTypeNode>({ children: (node) => node.fields.map((field) => field.type) })
const functionTypeClass = typeClass<FunctionTypeNode>({
  children: (node) => [...node.params, ...(node.rest === undefined ? [] : [node.rest]), node.returns],
})
const membersClass = typeClass<MembersTypeNode>({ children: (node) => node.members })
const tupleClass = typeClass<TupleTypeNode>({ children: (node) => node.elements.map((element) => element.type) })
const templateClass = typeClass<TemplateTypeNode>({ children: (node) => node.parts.filter((part) => typeof part !== "string") })
const conditionalClass = typeClass<ConditionalTypeNode>({ children: (node) => [node.check, node.branch, node.otherwise] })
const mappedClass = typeClass<MappedTypeNode>({ children: (node) => [node.keys, node.scope] })
const keyofClass = typeClass<KeyofTypeNode>({ children: (node) => [node.operand] })
const indexClass = typeClass<IndexTypeNode>({ children: (node) => [node.object, node.index] })
const aliasClass = stmtClass<TypeAliasNode>({
  children: (node) => [...node.params.flatMap((param) => (param.constraint === undefined ? [] : [param.constraint])), node.body],
  declares: (node) => [node.binding],
})
const typeRefClass = typeClass<TypeRefNode>({ children: (node) => node.args, references: (node) => [node.binding] })
const inferClass = typeClass<InferTypeNode>({
  children: (node) => (node.constraint === undefined ? [] : [node.constraint]),
  references: (node) => [node.binding],
})
const literalClass = exprClass<LiteralNode>()
const getClass = exprClass<GetNode>({ children: (node) => [node.object] })
const equalityClass = exprClass<EqualityNode>({ children: (node) => [node.left, node.right] })

const subjectOf = (node: AnyNode): Binding | undefined => {
  if (node.kind === "ref") return (node as unknown as RefNode).binding
  const { object } = node as unknown as Partial<GetNode>
  return node.kind === "get" && object?.kind === "ref" ? (object as unknown as RefNode).binding : undefined
}

const equality = <E>(operator: EqualityNode["operator"], left: AnyNode, right: AnyNode): E =>
  expr(equalityClass, { kind: "equality", operator, left, right, narrows: subjectOf(left) }) as E
const guardClass = exprClass<GuardNode>({ children: (node) => [node.subject] })
const notClass = exprClass<NotNode>({ children: (node) => [node.operand] })
const callClass = exprClass<CallNode & { readonly narrows: Binding | undefined }>({ children: (node) => [node.callee, ...node.args] })
const predicateClass = typeClass<PredicateTypeNode>({ children: (node) => [node.type] })

const guard = <G>(kind: GuardNode["kind"], subject: Ref<TS, any, any>, tag: string): G =>
  expr(guardClass, { kind, subject, narrows: subject.binding, tag }) as G

const predicates = new Map<BindingId, number>()
const base = functionConstruct<TS>()

const tsType = <M extends TypeLambda, F extends Facts>(
  nodeClass: NodeClass<any>,
  fields: Fields,
): TsType<M, F> => typeNode<TS, Evaluate<M>, F>(nodeClass, fields) as TsType<M, F>

type PrimitiveFacts = { readonly kind: "primitive-type" }
const primitive = <D>(name: PrimitiveTypeNode["name"]): TsType<Const<D>, PrimitiveFacts> => tsType(primitiveClass, { kind: "primitive-type", name })

const field = (value: FieldInput): Field => ("role" in value ? { type: value, readonly: false, optional: false } : value)

export const ts = {
  ...structured<TS>(),
  ...base,

  fn: <const P extends readonly Param<TS, any, any>[], R, FR extends Facts, Y>(
    name: string,
    params: P,
    returns: TypeNode<TS, R, FR> & Check<PredicateFits<P, R>, "a type predicate's type is not assignable to its parameter's type", { predicate: R }>,
    body: (...refs: ParamRefs<TS, P>) => Generator<Y, void, unknown>,
  ): FunctionResult<TS, P, R, FR, Y> => {
    const declared = base.fn(name, params, returns, body) as unknown as FunctionNode
    const { kind, index } = returns as unknown as PredicateTypeNode
    if (kind === "type-predicate") {
      if (params[index] === undefined) throw new Error(`the type predicate of "${name}" names parameter ${index}, which it does not have`)
      predicates.set(declared.binding.id, index)
    }
    return declared as unknown as FunctionResult<TS, P, R, FR, Y>
  },

  call: <Params extends readonly unknown[], R, FC extends Facts, const Args extends readonly Expr<TS, any, any>[]>(
    callee:
      & Expr<TS, Signature<Params, R> | ((...args: Params) => R), FC>
      & Check<
        ArgumentsAccepted<TS, Args, Params>,
        "arguments do not match the parameters",
        { params: Params; args: { [K in keyof Args]: Denotes<Args[K]> } }
      >,
    ...args: Args
  ): Called<R, Args, FC> => {
    const target = (callee as unknown as RefNode).binding
    const index = target === undefined ? undefined : predicates.get(target.id)
    const subject = index === undefined ? undefined : args[index]
    const narrows = subject?.kind === "ref" ? (subject as unknown as RefNode).binding : undefined
    return expr(callClass, { kind: "call", callee, args, narrows }) as Called<R, Args, FC>
  },

  predicate: <const I extends number, T extends AnyType>(
    index: I,
    type: T,
  ): TsType<Const<boolean & Predicate<I, Denotes<T>>>, { readonly kind: "type-predicate" } | FactsOf<T>> =>
    tsType(predicateClass, { kind: "type-predicate", index, type }),

  typeOf: <S extends Ref<TS, any, any>, const T extends Tag>(
    subject: S,
    tag: T,
  ): Guard<TypeofThen<Value<Denotes<S>>, T>, TypeofElse<Value<Denotes<S>>, T>, S, "typeof-guard"> => guard("typeof-guard", subject, tag),

  notNull: <S extends Ref<TS, any, any>>(subject: S): Guard<NonNullish<Value<Denotes<S>>>, Nullish<Value<Denotes<S>>>, S, "nullish-guard"> =>
    guard("nullish-guard", subject, "!="),

  isNull: <S extends Ref<TS, any, any>>(subject: S): Guard<Nullish<Value<Denotes<S>>>, NonNullish<Value<Denotes<S>>>, S, "nullish-guard"> =>
    guard("nullish-guard", subject, "=="),

  isArray: <S extends Ref<TS, any, any>>(
    subject: S,
  ): Guard<NarrowedTo<Value<Denotes<S>>, unknown[], any[]>, Excluded<Value<Denotes<S>>, any[]>, S, "array-guard"> =>
    guard("array-guard", subject, ""),

  get: <O extends Expr<TS, any, any>, const K extends keyof Value<Denotes<O>> & (string | number)>(
    object: O,
    key: K,
  ): Expr<TS, Value<Denotes<O>>[K], Extract<{ readonly kind: "get" } | FactsOf<O>, Facts>> & Access<O, K> =>
    expr(getClass, { kind: "get", object, key }),

  equals: <L extends Expr<TS, any, any>, R extends Expr<TS, any, any>>(
    left: L,
    right:
      & R
      & Check<
        Overlapping<Value<Denotes<L>>, Value<Denotes<R>>>,
        "the types have no overlap, so they are never equal",
        { left: Denotes<L>; right: Denotes<R> }
      >,
  ): Equality<L, R, false> => equality("===", left, right),

  notEquals: <L extends Expr<TS, any, any>, R extends Expr<TS, any, any>>(
    left: L,
    right:
      & R
      & Check<
        Overlapping<Value<Denotes<L>>, Value<Denotes<R>>>,
        "the types have no overlap, so they are never equal",
        { left: Denotes<L>; right: Denotes<R> }
      >,
  ): Equality<L, R, true> => equality("!==", left, right),

  not: <E extends Expr<TS, any, any>>(
    operand: E & Check<Kind<TsTruthy, [Denotes<E>]>, "condition has the wrong type", { condition: Denotes<E> }>,
  ): Negated<E> => expr(notClass, { kind: "not", operand, narrows: (operand as { readonly narrows?: Binding }).narrows }) as Negated<E>,

  ...addConstruct<TS>(),
  ...lessConstruct<TS>(),

  number: primitive<number>("number"),
  string: primitive<string>("string"),
  boolean: primitive<boolean>("boolean"),
  bigint: primitive<bigint>("bigint"),
  symbol: primitive<symbol>("symbol"),
  void: primitive<void>("void"),
  null: primitive<null>("null"),
  undefined: primitive<undefined>("undefined"),
  unknown: primitive<unknown>("unknown"),
  never: primitive<never>("never"),
  any: primitive<any>("any"),
  nonPrimitive: primitive<object>("object"),

  array: <E extends AnyType>(element: E): TsType<ArrayMeaning<MeaningOf<E>>, { readonly kind: "array-type" } | FactsOf<E>> =>
    tsType(arrayClass, { kind: "array-type", element, readonly: false }),

  readonlyArray: <E extends AnyType>(element: E): TsType<ReadonlyArrayMeaning<MeaningOf<E>>, { readonly kind: "array-type" } | FactsOf<E>> =>
    tsType(arrayClass, { kind: "array-type", element, readonly: true }),

  literalType: <const V extends LiteralValue>(value: V): TsType<Const<V>, { readonly kind: "literal-type" }> => {
    if (typeof value === "number" && !Number.isFinite(value)) throw new Error(`a literal type must be a finite number, got ${value}`)
    return tsType(literalTypeClass, { kind: "literal-type", value })
  },

  readonly: <const X extends FieldInput>(value: X): Field<FieldOf<X>["type"], true, FieldOf<X>["optional"]> =>
    ({ ...field(value), readonly: true }) as Field<FieldOf<X>["type"], true, FieldOf<X>["optional"]>,

  optional: <const X extends FieldInput>(value: X): Field<FieldOf<X>["type"], FieldOf<X>["readonly"], true> =>
    ({ ...field(value), optional: true }) as Field<FieldOf<X>["type"], FieldOf<X>["readonly"], true>,

  object: <const Fs extends { readonly [key: string]: FieldInput }>(
    fields: Fs,
  ): TsType<
    ObjectMeaning<{ readonly [K in Exclude<keyof Fs, symbol>]: FieldMeaning<Fs[K]> }>,
    { readonly kind: "object-type" } | FactsOf<FieldOf<Fs[keyof Fs]>["type"]>
  > => tsType(objectClass, { kind: "object-type", fields: Object.entries(fields).map(([key, value]) => ({ key, ...field(value) })) }),

  functionType: <
    const P extends readonly AnyType[],
    R extends AnyType,
    S extends TypeNode<TS, readonly unknown[], any> | TsType<VarMeaning<string, TypeLambda>, { readonly kind: "infer-type" }> = never,
  >(
    params: P,
    returns: R,
    rest?: S,
  ): TsType<
    FunctionMeaning<Meanings<P>, MeaningOf<R>, [S] extends [never] ? undefined : MeaningOf<S>>,
    { readonly kind: "function-type" } | FactsOf<P[number] | R | S>
  > => tsType(functionTypeClass, { kind: "function-type", params, rest, returns }),

  union: <const T extends readonly [AnyType, AnyType, ...AnyType[]]>(
    ...members: T
  ): TsType<UnionMeaning<Meanings<T>>, { readonly kind: "union-type" } | FactsOf<T[number]>> => tsType(membersClass, { kind: "union-type", members }),

  intersection: <const T extends readonly [AnyType, AnyType, ...AnyType[]]>(
    ...members: T
  ): TsType<IntersectionMeaning<Meanings<T>>, { readonly kind: "intersection-type" } | FactsOf<T[number]>> =>
    tsType(membersClass, { kind: "intersection-type", members }),

  spread: <T extends TypeNode<TS, readonly unknown[], any> | TsType<VarMeaning<string, TypeLambda>, { readonly kind: "infer-type" }>>(
    type: T,
  ): Spread<T> => ({
    spread: type,
  }),

  tuple: <const T extends readonly ElementInput[]>(
    ...elements: T & Check<RequiredAfterOptional<T> extends true ? false : true, "a required element cannot follow an optional element">
  ): TsType<TupleMeaning<ElementMeanings<T>>, { readonly kind: "tuple-type" } | FactsOf<ElementType<T[number]>>> =>
    tsType(tupleClass, {
      kind: "tuple-type",
      elements: elements.map((element) =>
        "spread" in element
          ? { type: element.spread, element: "spread" }
          : "role" in element
          ? { type: element, element: "required" }
          : { type: element.type, element: "optional" }
      ),
    }),

  keyof: <T extends AnyType>(operand: T): TsType<KeyofMeaning<MeaningOf<T>>, { readonly kind: "keyof-type" } | FactsOf<T>> =>
    tsType(keyofClass, { kind: "keyof-type", operand }),

  index: <O extends AnyType, K extends TypeNode<TS, keyof Denotes<O>, any>>(
    object: O,
    index: K,
  ): TsType<IndexMeaning<MeaningOf<O>, MeaningOf<K>>, { readonly kind: "index-type" } | FactsOf<O> | FactsOf<K>> =>
    tsType(indexClass, { kind: "index-type", object, index }),

  conditional: <C extends AnyType, P extends AnyType, T extends AnyType, F extends AnyType>(
    check: C,
    extendsType: P,
    then: T,
    otherwise: F,
  ): TsType<
    ConditionalMeaning<VariableOf<C>, MeaningOf<C>, MeaningOf<P>, MeaningOf<T>, MeaningOf<F>, NoInfers>,
    { readonly kind: "conditional-type" } | FactsOf<C | P | T | F>
  > => tsType(conditionalClass, { kind: "conditional-type", check, infers: [], branch: scope([], [extendsType, then]), otherwise }),

  infer: <
    C extends AnyType,
    const S extends InferSpecs,
    P extends InferBody<InfersOf<S>, "infer-type">,
    T extends InferBody<InfersOf<S>, "type-param">,
    F extends AnyType,
  >(
    check: C,
    names: S,
    pattern: P,
    then: T,
    otherwise: F,
  ): TsType<
    ConditionalMeaning<VariableOf<C>, MeaningOf<C>, MeaningOf<Returned<P>>, MeaningOf<Returned<T>>, MeaningOf<F>, InfersOf<S>>,
    | { readonly kind: "conditional-type" | "infer-type" | "type-param" }
    | FactsOf<C | F>
    | InferConstraintFacts<S>
    | Specific<FactsOf<Returned<P> | Returned<T>>>
  > => {
    const specs = names.map((spec): readonly [string, AnyType | undefined] => (typeof spec === "string" ? [spec, undefined] : spec))
    const infers = specs.map(([name]) => binding(name))
    const declarations = infers.map((declared, index) => tsType(inferClass, { kind: "infer-type", binding: declared, constraint: specs[index]?.[1] }))
    const references = infers.map((declared) => tsType(typeRefClass, { kind: "type-param", binding: declared, args: [] }))
    const extendsType = (pattern as unknown as (...vars: AnyType[]) => AnyType)(...declarations)
    const branch = scope(infers, [extendsType, (then as unknown as (...vars: AnyType[]) => AnyType)(...references)])
    return tsType(conditionalClass, { kind: "conditional-type", check, infers, branch, otherwise })
  },

  mapped: <
    const Name extends string,
    Keys extends AnyType,
    B extends MappedBody<Name, Denotes<Keys>>,
    A extends MappedBody<Name, Denotes<Keys>>,
    R extends Modifier = undefined,
    O extends Modifier = undefined,
  >(
    name: Name,
    keys: Keys,
    body: B,
    options?: MappedModifiers<R, O, A>,
  ): TsType<
    MappedMeaning<
      Name,
      MeaningOf<Keys>,
      MeaningOf<Returned<B>>,
      [Remap<Name, Keys, A>] extends [never] ? undefined : MeaningOf<Remap<Name, Keys, A>>,
      R,
      O
    >,
    { readonly kind: "mapped-type" | "type-param" } | FactsOf<Keys> | Specific<FactsOf<Returned<B> | Remap<Name, Keys, A>>>
  > => {
    const key = binding(name)
    const ref = () => tsType(typeRefClass, { kind: "type-param", binding: key, args: [] })
    const remap = options?.as as ((key: AnyType) => AnyType) | undefined
    const statements = [(body as unknown as (key: AnyType) => AnyType)(ref()), ...(remap === undefined ? [] : [remap(ref())])]
    return tsType(mappedClass, {
      kind: "mapped-type",
      key,
      keys,
      scope: scope([key], statements),
      readonly: options?.readonly,
      optional: options?.optional,
    })
  },

  typeParam: <C = unknown, F extends Facts = never>(nameHint: string, constraint?: TypeNode<TS, C, F>): TypeParam<NoInfer<C>, NoInfer<F>> => ({
    binding: binding(nameHint),
    constraint,
  }),

  alias: <const N extends string, const P extends readonly TypeParam<any, any>[], B extends AliasBody<N, P>>(
    name: N,
    params: P,
    body: B,
  ): AliasResult<N, P, B> => {
    if (body.length !== params.length) {
      throw new Error(`the body of type alias "${name}" takes ${body.length} arguments for ${params.length} type parameters`)
    }
    const declared = binding(name)
    const refs = params.map((param) => tsType(typeRefClass, { kind: "type-param", binding: param.binding, args: [] }))
    const block = scope(params.map((param) => param.binding), [(body as unknown as (...refs: AnyType[]) => AnyType)(...refs)])
    const apply = (...args: AnyType[]) => tsType(typeRefClass, { kind: "type-ref", binding: declared, args })
    return stmt(aliasClass, { kind: "type-alias", binding: declared, params, body: block }, params.length === 0 ? apply() : apply) as AliasResult<
      N,
      P,
      B
    >
  },

  template: <const Parts extends readonly TemplatePart[]>(
    ...parts:
      & Parts
      & Check<[NonLiteralPart<Parts>] extends [never] ? true : false, "a template's text must be a literal string", { part: NonLiteralPart<Parts> }>
  ): TsType<TemplateMeaning<TemplateMeanings<Parts>>, { readonly kind: "template-type" } | TemplateFacts<Parts>> =>
    tsType(templateClass, { kind: "template-type", parts }),

  literal: <const V extends number | string | boolean | bigint | null>(value: V): Expr<TS, V, { readonly kind: "literal" }> =>
    expr(literalClass, { kind: "literal", value }),

  program: <Y extends Stmt<TS, any, any>>(body: () => Generator<Y, void, unknown>): Program<TS, KindsOf<Y>> => {
    const program = builder<TS>()(body)
    checkTypeVariables(program.root, new Map())
    return program
  },
}

const checkTypeVariables = (node: AnyNode, visible: ReadonlyMap<string, Binding>, bound: ReadonlySet<Binding> = new Set()): void => {
  if (node.kind === "type-alias") return children(node).forEach((child) => checkTypeVariables(child, new Map()))
  if (node.kind === "conditional-type") {
    const { check, infers, branch, otherwise } = node as unknown as ConditionalTypeNode
    checkTypeVariables(check, visible, bound)
    checkTypeVariables(otherwise, visible, bound)
    const inner = new Map(visible)
    infers.forEach((declared) => inner.set(declared.nameHint, declared))
    return branch.statements.forEach((child) => checkTypeVariables(child, inner, new Set([...bound, ...infers])))
  }
  if (node.kind === "mapped-type") {
    const { keys, key, scope } = node as unknown as MappedTypeNode
    checkTypeVariables(keys, visible, bound)
    return scope.statements.forEach((child) => checkTypeVariables(child, new Map([...visible, [key.nameHint, key]]), new Set([...bound, key])))
  }
  if (node.kind === "type-param" || node.kind === "infer-type") {
    const { binding: used } = node as unknown as TypeRefNode
    if (bound.has(used) && visible.get(used.nameHint) !== used) {
      throw new Error(`type variable "${used.nameHint}" is used where another type variable of the same name shadows it; rename one of them`)
    }
  }
  children(node).forEach((child) => checkTypeVariables(child, visible, bound))
}

const KEYWORDS = (
  "await break case catch class const continue debugger default delete do else enum export extends false finally for function if "
  + "implements import in instanceof interface let new null package private protected public return static super switch this throw "
  + "true try typeof var void while with yield arguments eval Array any bigint boolean never number object string symbol undefined unknown"
).split(" ")

const POSTFIX = 17
const UNARY = 14
const MULTIPLY = 13
const ADD = 12
const RELATIONAL = 10
const EQUALITY = 9

const TYPE_CONDITIONAL = 0
const TYPE_FUNCTION = 1
const TYPE_UNION = 2
const TYPE_INTERSECTION = 3
const TYPE_OPERATOR = 4
const TYPE_POSTFIX = 5

const IDENTIFIER = /^[\p{ID_Start}$_][\p{ID_Continue}$\u200C\u200D]*$/u

const propertyKey = (key: string): string => (IDENTIFIER.test(key) ? key : JSON.stringify(key))

const templateText = (text: string): string => text.replace(/[`\\]|\$\{/g, (match) => `\\${match}`).replaceAll("\r", "\\r")

const literalText = (value: LiteralValue): string => (typeof value === "bigint" ? `${value}n` : value === null ? "null" : JSON.stringify(value))

export const tsTarget = defineTarget({
  valid: (name) => IDENTIFIER.test(name),
  reserved: new Set(KEYWORDS),
}, {
  "primitive-type": (node: PrimitiveTypeNode) => node.name,
  "array-type": (node: ArrayTypeNode, emit) =>
    node.readonly
      ? frag(TYPE_OPERATOR, `readonly ${emit.at(node.element, TYPE_POSTFIX)}[]`)
      : frag(TYPE_POSTFIX, `${emit.at(node.element, TYPE_POSTFIX)}[]`),
  "literal-type": (node: LiteralTypeNode) => literalText(node.value),
  "object-type": (node: ObjectTypeNode, emit) =>
    node.fields.length === 0
      ? "{}"
      : `{ ${
        node.fields.map((field) =>
          `${field.readonly ? "readonly " : ""}${propertyKey(field.key)}${field.optional ? "?" : ""}: ${emit.node(field.type).text}`
        )
          .join("; ")
      } }`,
  "union-type": (node: MembersTypeNode, emit) => frag(TYPE_UNION, node.members.map((member) => emit.at(member, TYPE_UNION)).join(" | ")),
  "intersection-type": (node: MembersTypeNode, emit) =>
    frag(TYPE_INTERSECTION, node.members.map((member) => emit.at(member, TYPE_INTERSECTION)).join(" & ")),
  "function-type": (node: FunctionTypeNode, emit) => {
    const params = node.params.map((param, index) => `arg${index}: ${emit.at(param, TYPE_FUNCTION)}`)
    const rest = node.rest === undefined ? [] : [`...rest: ${emit.at(node.rest, TYPE_FUNCTION)}`]
    return frag(TYPE_FUNCTION, `(${[...params, ...rest].join(", ")}) => ${emit.at(node.returns, TYPE_FUNCTION)}`)
  },
  "tuple-type": (node: TupleTypeNode, emit) =>
    `[${
      node.elements.map(({ type, element }) =>
        element === "spread" ? `...${emit.node(type).text}` : element === "optional" ? `${emit.at(type, TYPE_POSTFIX)}?` : emit.node(type).text
      ).join(", ")
    }]`,
  "keyof-type": (node: KeyofTypeNode, emit) => frag(TYPE_OPERATOR, `keyof ${emit.at(node.operand, TYPE_OPERATOR)}`),
  "index-type": (node: IndexTypeNode, emit) => frag(TYPE_POSTFIX, `${emit.at(node.object, TYPE_POSTFIX)}[${emit.node(node.index).text}]`),
  "type-param": (node: TypeRefNode, emit) => emit.name(node.binding),
  "infer-type": (node: InferTypeNode, emit) =>
    node.constraint === undefined
      ? frag(TYPE_OPERATOR, `infer ${emit.name(node.binding)}`)
      : frag(TYPE_CONDITIONAL, `infer ${emit.name(node.binding)} extends ${emit.at(node.constraint, TYPE_UNION)}`),
  "mapped-type": (node: MappedTypeNode, emit) => {
    const [body, remap] = node.scope.statements
    if (body === undefined) throw new Error("a mapped type needs a body")
    const readonly = node.readonly === undefined ? "" : `${node.readonly === "-" ? "-" : ""}readonly `
    const optional = node.optional === undefined ? "" : `${node.optional === "-" ? "-" : ""}?`
    const as = remap === undefined ? "" : ` as ${emit.node(remap).text}`
    return `{ ${readonly}[${emit.name(node.key)} in ${emit.node(node.keys).text}${as}]${optional}: ${emit.node(body).text} }`
  },
  "conditional-type": (node: ConditionalTypeNode, emit) => {
    const [extendsType, then] = node.branch.statements
    if (extendsType === undefined || then === undefined) throw new Error("a conditional type needs an extends type and a true branch")
    return frag(
      TYPE_CONDITIONAL,
      `${emit.at(node.check, TYPE_UNION)} extends ${emit.at(extendsType, TYPE_FUNCTION)} ? ${emit.node(then).text} : ${
        emit.node(node.otherwise).text
      }`,
    )
  },
  "type-ref": (node: TypeRefNode, emit) =>
    node.args.length === 0 ? emit.name(node.binding) : `${emit.name(node.binding)}<${node.args.map((arg) => emit.node(arg).text).join(", ")}>`,
  "type-alias": (node: TypeAliasNode, emit) => {
    const params = node.params.map((param) =>
      param.constraint === undefined ? emit.name(param.binding) : `${emit.name(param.binding)} extends ${emit.node(param.constraint).text}`
    )
    const body = node.body.statements[0]
    if (body === undefined) throw new Error("a type alias needs a body")
    return `type ${emit.name(node.binding)}${params.length === 0 ? "" : `<${params.join(", ")}>`} = ${emit.node(body).text};`
  },
  "template-type": (node: TemplateTypeNode, emit) => {
    const pieces = node.parts.reduce<Array<string | AnyNode>>((merged, part) => {
      const last = merged.at(-1)
      return typeof part === "string" && typeof last === "string" ? [...merged.slice(0, -1), last + part] : [...merged, part]
    }, [])
    return `\`${pieces.map((piece) => (typeof piece === "string" ? templateText(piece) : `\${${emit.node(piece).text}}`)).join("")}\``
  },
  literal: (node: LiteralNode): Fragment => {
    const { value } = node
    if (value === null) return frag(POSTFIX, "null")
    if (typeof value === "bigint") return frag(value < 0n ? UNARY : POSTFIX, `${value}n`)
    if (typeof value === "string") return frag(POSTFIX, JSON.stringify(value))
    if (typeof value === "boolean") return frag(POSTFIX, String(value))
    if (Object.is(value, -0)) return frag(UNARY, "-0")
    if (Number.isNaN(value)) return frag(MULTIPLY, "0 / 0")
    if (value === Infinity) return frag(MULTIPLY, "1 / 0")
    if (value === -Infinity) return frag(MULTIPLY, "-1 / 0")
    return frag(UNARY, String(value))
  },
  ref: (node: RefNode, emit) => emit.name(node.binding),
  add: (node: BinaryNode, emit) => ({ prec: ADD, text: `${emit.at(node.left, ADD)} + ${emit.at(node.right, ADD + 1)}` }),
  less: (node: BinaryNode, emit) => ({ prec: RELATIONAL, text: `${emit.at(node.left, RELATIONAL)} < ${emit.at(node.right, RELATIONAL + 1)}` }),
  call: (node: CallNode, emit) => ({
    prec: POSTFIX,
    text: `${emit.at(node.callee, POSTFIX)}(${node.args.map((arg) => emit.node(arg).text).join(", ")})`,
  }),
  let: (node: LetNode, emit) => `let ${emit.name(node.binding)}: ${emit.node(node.type).text} = ${emit.node(node.init).text};`,
  assign: (node: AssignNode, emit) => `${emit.node(node.target).text} = ${emit.node(node.value).text};`,
  expression: (node: ExpressionNode, emit) => `${emit.node(node.expr).text};`,
  if: (node: IfNode, emit) => {
    const then = `if (${emit.node(node.condition).text}) ${braces(emit.block(node.then))}`
    return node.else === undefined ? then : `${then} else ${braces(emit.block(node.else))}`
  },
  while: (node: WhileNode, emit) => `while (${emit.node(node.condition).text}) ${braces(emit.block(node.body))}`,
  "typeof-guard": (node: GuardNode, emit) => frag(EQUALITY, `typeof ${emit.at(node.subject, UNARY)} === ${JSON.stringify(node.tag)}`),
  "nullish-guard": (node: GuardNode, emit) => frag(EQUALITY, `${emit.at(node.subject, EQUALITY)} ${node.tag} null`),
  "array-guard": (node: GuardNode, emit) => frag(POSTFIX, `Array.isArray(${emit.node(node.subject).text})`),
  get: (node: GetNode, emit) =>
    frag(
      POSTFIX,
      typeof node.key === "string" && IDENTIFIER.test(node.key)
        ? `${emit.at(node.object, POSTFIX)}.${node.key}`
        : `${emit.at(node.object, POSTFIX)}[${JSON.stringify(node.key)}]`,
    ),
  equality: (node: EqualityNode, emit) => frag(EQUALITY, `${emit.at(node.left, EQUALITY)} ${node.operator} ${emit.at(node.right, EQUALITY + 1)}`),
  not: (node: NotNode, emit) => frag(UNARY, `!${emit.at(node.operand, UNARY)}`),
  "type-predicate": (): never => {
    throw new Error("a type predicate can only be the result type of a function")
  },
  return: (node: ReturnNode, emit) => `return ${emit.node(node.value).text};`,
  function: (node: FunctionNode, emit) => {
    const params = node.params.map((param) => `${emit.name(param.binding)}: ${emit.node(param.type).text}`).join(", ")
    const predicate = node.returns.kind === "type-predicate" ? (node.returns as unknown as PredicateTypeNode) : undefined
    const guarded = predicate === undefined ? undefined : node.params[predicate.index]
    const returns = predicate === undefined || guarded === undefined
      ? emit.node(node.returns).text
      : `${emit.name(guarded.binding)} is ${emit.node(predicate.type).text}`
    return `function ${emit.name(node.binding)}(${params}): ${returns} ${braces(emit.block(node.body))}`
  },
})

export const emitTs = <Kinds extends keyof typeof tsTarget.handlers>(program: Program<TS, Kinds>): string =>
  emit(program as Program<TS, keyof typeof tsTarget.handlers>, tsTarget)
