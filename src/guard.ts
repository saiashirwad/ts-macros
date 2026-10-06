import * as Expr from "./expr.ts"
import * as FFI from "./ffi.ts"
import { isPrimitive, lub } from "./types/algebra.ts"
import type { Equal, IsUnion } from "./types/core.ts"
import * as Type from "./types/index.ts"

/** a runtime test and the type of a fresh binding inside its successful branch */
export interface Guard<Out> {
  readonly condition: Expr.Expr<boolean>
  readonly subject: Expr.Expr<any>
  readonly type: Type.Type<Out>
  /** rebuilds the test against a saved subject, without evaluating the original twice */
  readonly test: (subject: Expr.Expr<any>) => Expr.Expr<boolean>
  /** Prevents initializer flow-narrowing from erasing alternatives of an annotated alias. */
  readonly initialize?: ((subject: Expr.Expr<any>) => Expr.Expr<any>) | undefined
}

/** A type-level refinement is reapplied to the left guard's result by `and`. */
export interface Refinement {
  readonly input: unknown
  readonly output: unknown
  readonly check: readonly unknown[]
  readonly negative: unknown
  readonly negativeCheck: readonly unknown[]
}

export type Refined<R extends Refinement, A> = (R & { readonly input: A })["output"]
type CheckApply<R extends Refinement, A> = (R & { readonly input: A })["check"]
export type Reject<R extends Refinement, A> = (R & { readonly input: A })["negative"]
export type CheckReject<R extends Refinement, A> = (R & { readonly input: A })["negativeCheck"]

export interface RefinedGuard<Out, R extends Refinement, A = unknown> extends Guard<Out> {
  /** Type-level witness; refinements have no stage-2 representation. */
  readonly refinement?: R
  readonly refine: (type: Type.Type<any>) => Type.Type<any>
  readonly complement: Type.Type<Reject<R, A>>
  readonly reject: (type: Type.Type<any>) => Type.Type<any>
  readonly complementCheck?: CheckReject<R, A>
  readonly inputType: Type.Type<A>
}

export type Complement<G> = G extends { readonly complement: Type.Type<infer A> } ? A : never
export type CheckComplement<G> = G extends { readonly complementCheck?: infer C extends readonly unknown[] } ? C
  : ["this guard does not describe an exact false branch"]

export interface TypeofRefinement<T extends Tag> extends Refinement {
  readonly output: Typeof<this["input"], T>
  readonly check: CheckTypeof<this["input"]>
  readonly negative: NotTypeof<this["input"], T>
  readonly negativeCheck: CheckTypeof<this["input"]>
}

export interface NotNullishRefinement extends Refinement {
  readonly output: NonNullable<this["input"]>
  readonly check: CheckConcrete<this["input"]>
  readonly negative: Nullish<this["input"]>
  readonly negativeCheck: CheckConcrete<this["input"]>
}

export interface ArrayRefinement extends Refinement {
  readonly output: ArrayOf<this["input"]>
  readonly check: CheckArray<this["input"]>
  readonly negative: unknown extends this["input"] ? unknown : Exclude<this["input"], any[]>
  readonly negativeCheck: CheckArray<this["input"]>
}

export interface AndRefinement<L extends Refinement, R extends Refinement> extends Refinement {
  readonly output: Refined<R, Refined<L, this["input"]>>
  readonly check: [...CheckApply<L, this["input"]>, ...CheckApply<R, Refined<L, this["input"]>>]
  readonly negative: NegativeUnion<Reject<L, this["input"]>, Reject<R, Refined<L, this["input"]>>>
  readonly negativeCheck: [
    ...CheckReject<L, this["input"]>,
    ...CheckReject<R, Refined<L, this["input"]>>,
    ...CheckNegativeUnion<Reject<L, this["input"]>, Reject<R, Refined<L, this["input"]>>>,
  ]
}

interface Tags {
  readonly string: string
  readonly number: number
  readonly boolean: boolean
  readonly bigint: bigint
  readonly symbol: symbol
  readonly undefined: undefined
  readonly object: object | null
  // oxlint-disable-next-line typescript/no-unsafe-function-type -- This is precisely TypeScript's typeof narrowing of unknown.
  readonly function: Function
}

export type Tag = keyof Tags

export type Typeof<A, T extends Tag> =
    unknown extends A ? Tags[T]
  : T extends "object" ? Exclude<Extract<A, Tags[T]>, Tags["function"]>
  : T extends "function" ?
      Tags[T] extends A ? Tags[T]
    : Extract<A, Tags[T]>
  : Extract<A, Tags[T]>
export type ArrayOf<A> = unknown extends A ? unknown[] : Extract<A, readonly unknown[]>
type NegativeUnion<A, B> = unknown extends A | B ? unknown : A | B
type CheckNegativeUnion<A, B> =
    unknown extends A | B ? []
  : Equal<Extract<A, B>, Extract<B, A>> extends true ? []
  : ["and complement cannot merge partially overlapping false branches"]
export type NotTypeof<A, T extends Tag> =
    unknown extends A ?
      T extends "undefined" ? {} | null
    : T extends "object" ? {} | undefined
    : unknown
  : T extends "object" ? Exclude<A, Tags[T]> | Extract<A, Tags["function"]>
  : Exclude<A, Tags[T]>
export type Nullish<A> =
    unknown extends A ? null | undefined
  : A extends void ? A
  : Extract<A, null>

type CheckConcrete<A> =
    Type.IsAny<A> extends true ? ["a guard needs a concrete subject type"]
  : Type.Abstract<A> extends true ? ["cannot guard a symbolic subject type"]
  : []

type UnsupportedTypeof<A> =
    A extends string | number | boolean | bigint | symbol | null | undefined | object ?
      Equal<A, {}> extends true ? A
    : never
  : unknown extends A ? never
  : A
type CheckTypeof<A> = [...CheckConcrete<A>, ...([UnsupportedTypeof<A>] extends [never] ? [] : ["cannot typeof-guard this subject type", A])]

type UnsupportedArray<A> = A extends string | number | boolean | bigint | symbol | null | undefined | readonly unknown[] ? never : A
type CheckArray<A> = [
  ...CheckConcrete<A>,
  ...(unknown extends A ? [] : [UnsupportedArray<A>] extends [never] ? [] : ["an array guard needs unknown, arrays, or primitive union members", A]),
]

type CheckTag<T> = true extends IsUnion<T> ? ["a typeof guard needs one literal tag"] : []

const descriptor = (subject: Expr.Expr<any>): Type.Type<any> => {
  if (subject.type === undefined) throw new Error("a guard needs subject type metadata; use a typed binding")
  return subject.type
}

const make = <Out, R extends Refinement, A>(
  subject: Expr.Expr<any>,
  test: Guard<Out>["test"],
  refine: RefinedGuard<Out, R>["refine"],
  reject: RefinedGuard<Out, R>["reject"],
): RefinedGuard<Out, R, A> => {
  const input = descriptor(subject)
  const type = refine(input)
  return {
    condition: test(subject),
    subject,
    type,
    test,
    refine,
    reject,
    complement: reject(input),
    inputType: input,
    initialize: arrayInitializer(type),
  }
}

// Native Array.isArray drops readonly alternatives when a mutable one exists.
// A typed identity call preserves the annotated alias's full union without a
// cast, closure capture, or another evaluation of the subject.
const arrayInitializer = (type: Type.Type<any>): Guard<any>["initialize"] => {
  const alternatives = members(type) as Type.AnyType[]
  if (
    !alternatives.some((item) => item.kind === "array" && item.readonly)
    || !alternatives.some((item) => item.kind === "tuple" || (item.kind === "array" && !item.readonly))
  ) return undefined
  return (subject) => initializeAlias(type, subject)
}

/** A typed identity call prevents declaration narrowing of union aliases. */
export const initializeAlias = (type: Type.Type<any>, subject: Expr.Expr<any>): Expr.Expr<any> =>
  Expr.call(
    Expr.arrow({
      params: [Expr.param("value", type)],
      returns: type,
      // oxlint-disable-next-line require-yield -- A staged body returns its final expression without yielding a statement.
      body: function*({ value }) {
        return value
      },
    }),
    subject,
  )

const tags = {
  string: Type.String,
  number: Type.Number,
  boolean: Type.Boolean,
  bigint: Type.BigInt,
  symbol: Type.Symbol,
  undefined: Type.Undefined,
  object: Type.Union(Type.NonPrimitive, Type.Null),
  function: Type.External<Tags["function"]>("Function"),
} satisfies { readonly [T in Tag]: Type.Type<Tags[T]> }

const isUnknown = (type: Type.Type<any>): boolean => {
  const node = type as Type.AnyType
  return node.kind === "primitive" ? node.name === "unknown" : node.kind === "union" && node.members.some(isUnknown)
}

const isFunctionType = (node: Type.AnyType): boolean => node.kind === "external" && node.name === "Function" && node.args.length === 0

const isConcreteNode = (node: Type.AnyType): boolean =>
  node.kind === "primitive" || node.kind === "literal" || node.kind === "template-literal" || node.kind === "object" || node.kind === "array"
  || node.kind === "tuple" || node.kind === "function" || isFunctionType(node)

const concrete = (type: Type.Type<any>): void => {
  const node = type as Type.AnyType
  if (node.kind === "union") {
    node.members.forEach(concrete)
    return
  }
  if (isConcreteNode(node)) return
  if (node.kind === "intersection") {
    objectMembers(type)
    return
  }
  throw new Error("a guard needs concrete subject type metadata")
}

const members = (type: Type.Type<any>): Type.Type<any>[] => {
  const node = type as Type.AnyType
  return node.kind === "union" ? node.members.flatMap(members) : [type]
}

const filtered = (types: Type.Type<any>[]): Type.Type<any> => types.length === 0 ? Type.Never : lub(types)

const matches = (type: Type.Type<any>, tag: Tag): boolean => {
  const node = type as Type.AnyType
  switch (node.kind) {
    case "primitive":
      return node.name === "null" ? tag === "object" : node.name === tag
    case "literal":
      return typeof node.value === tag
    case "template-literal":
      return tag === "string"
    case "object":
    case "array":
    case "tuple":
    case "intersection":
      return tag === "object"
    case "function":
      return tag === "function"
    case "external":
      return isFunctionType(node) && tag === "function"
    default:
      return false
  }
}

/** `typeof subject === tag`, retaining matching union members */
export const isTypeof = <const E extends Expr.Expr<any>, const T extends Tag>(
  subject: E,
  tag: T,
  ..._check: [...CheckTypeof<Expr.Denotes<E>>, ...CheckTag<T>]
): RefinedGuard<Typeof<Expr.Denotes<E>, T>, TypeofRefinement<T>, Expr.Denotes<E>> => {
  const refine = (type: Type.Type<any>) => {
    concrete(type)
    if (
      tag === "function" && members(type).some((member) => isPrimitive(member, "object") || isFunctionType(member as Type.AnyType))
    ) return tags.function
    return isUnknown(type) ? tags[tag] : filtered(members(type).filter((member) => matches(member, tag)))
  }
  return make(
    subject,
    (value) => Expr.eq(Expr.typeof(value), tag as Tag),
    refine,
    (type) =>
      isUnknown(type)
        ? tag === "undefined"
          ? Type.Union(Type.Object({}), Type.Null)
          : tag === "object"
          ? Type.Union(Type.Object({}), Type.Undefined)
          : Type.Unknown
        : filtered(members(type).filter((member) => !matches(member, tag))),
  )
}

/** `subject !== null && subject !== undefined` */
export const notNullish = <const E extends Expr.Expr<any>>(
  subject: E,
  ..._check: CheckConcrete<Expr.Denotes<E>>
): RefinedGuard<NonNullable<Expr.Denotes<E>>, NotNullishRefinement, Expr.Denotes<E>> => {
  const refine = (type: Type.Type<any>) =>
    isUnknown(type) ? Type.Object({}) : filtered(
      members(type).map((member) => {
        const node = member as Type.AnyType
        if (node.kind === "literal") return node.value === null ? Type.Never : member
        if (node.kind === "primitive") {
          if (node.name === "null" || node.name === "undefined") return Type.Never
          if (node.name === "void") return Type.External("NonNullable", member)
        }
        return isConcreteNode(node) || node.kind === "intersection" ? member : Type.External("NonNullable", member)
      }).filter((member) => !isPrimitive(member, "never")),
    )
  return make(
    subject,
    (value) => Expr.and(Expr.neq(value, Expr.null()), Expr.neq(value, FFI.hostValue<undefined>("undefined"))),
    refine,
    (type) =>
      isUnknown(type) ? Type.Union(Type.Null, Type.Undefined) : filtered(
        members(type).filter((member) => {
          const node = member as Type.AnyType
          return isPrimitive(member, "null", "undefined", "void") || (node.kind === "literal" && node.value === null)
        }),
      ),
  )
}

/** `Array.isArray(subject)`, retaining mutable and readonly array union members */
export const isArray = <const E extends Expr.Expr<any>>(
  subject: E,
  ..._check: CheckArray<Expr.Denotes<E>>
): RefinedGuard<ArrayOf<Expr.Denotes<E>>, ArrayRefinement, Expr.Denotes<E>> => {
  const refine = (type: Type.Type<any>) => {
    concrete(type)
    return isUnknown(type) ? Type.Array(Type.Unknown) : filtered(members(type).filter((member) => member.kind === "array" || member.kind === "tuple"))
  }
  return make(
    subject,
    (value) => Expr.call(Expr.prop(FFI.hostValue<{ isArray: (value: unknown) => boolean }>("Array"), "isArray"), value),
    refine,
    (type) =>
      isUnknown(type)
        ? Type.Unknown
        : filtered(members(type).filter((member) => member.kind !== "tuple" && (member.kind !== "array" || (member as Type.Array).readonly))),
  )
}

type Constructor = abstract new(...args: any[]) => object
type Instance<C> = C extends abstract new(...args: any[]) => infer T ? T : never
type CheckConstructor<C> = [
  ...(Type.IsAny<C> extends true ? ["a constructor needs a concrete type"] : []),
  ...(true extends IsUnion<C> ? ["instanceof needs one constructor type"] : []),
  ...("prototype" extends keyof C
    ? C extends { readonly prototype: infer P } ? Equal<P, Instance<C>> extends true ? [] : ["constructor prototype must equal its instance type"]
    : []
    : []),
  ...(C extends { [Symbol.hasInstance]: (value: any) => value is any } ? ["custom hasInstance predicates are not supported"] : []),
]
type CheckWitness<T, A> = [
  ...CheckConcrete<T>,
  ...(Equal<T, A> extends true ? [] : ["the explicit type must equal the narrowed type", T, A]),
]

type CheckInstance<A, T> = [
  ...CheckConcrete<A>,
  ...(unknown extends A ? []
    : Equal<A, object> extends true ? []
    : Equal<Exclude<A, null | undefined>, T> extends true ? []
    : ["instanceof needs unknown, object, or a nullable exact instance type", A]),
]

export interface InstanceRefinement<T> extends Refinement {
  readonly output: T
  readonly check: CheckInstance<this["input"], T>
  readonly negative: unknown extends this["input"] ? unknown : Exclude<this["input"], T>
  readonly negativeCheck: CheckInstance<this["input"], T>
}

/** `subject instanceof ctor`; the explicit witness spells the constructor's instance type. */
export const instanceOf = <const E extends Expr.Expr<any>, const C extends Expr.ExternalExpr<Constructor>, const T extends Type.Type<any>>(
  subject: E,
  ctor: C,
  type: T,
  ..._check: [
    ...CheckConstructor<Expr.Denotes<C>>,
    ...CheckWitness<Instance<Expr.Denotes<C>>, Type.TypeDenotes<T>>,
    ...CheckInstance<Expr.Denotes<E>, Instance<Expr.Denotes<C>>>,
  ]
): RefinedGuard<Instance<Expr.Denotes<C>>, InstanceRefinement<Instance<Expr.Denotes<C>>>, Expr.Denotes<E>> => {
  const refine = (_subject: Type.Type<any>) => type
  return make(
    subject,
    (value) => Expr.binary("instanceof", value, ctor as Expr.Expr<Constructor>),
    refine,
    (input) => isUnknown(input) ? Type.Unknown : Type.External("Exclude", input, type),
  )
}

export type PredicateType<F> = F extends (value: any) => value is infer T ? T : never
type PredicateParam<F> = F extends (value: infer P) => boolean ? P : never
type UnaryPredicate<P, T extends P> = (value: P) => value is T
type CheckPredicate<F, A, T> = [
  ...(Type.IsAny<F> extends true ? ["a predicate needs a concrete function type"]
    : [F] extends [(value: any) => value is any] ? [] : ["a predicate needs a type-predicate function"]),
  ...CheckWitness<PredicateType<F>, T>,
  ...(true extends IsUnion<F> ? ["a predicate needs one function type"] : []),
  ...(Equal<F, UnaryPredicate<PredicateParam<F>, Extract<PredicateType<F>, PredicateParam<F>>>> extends true ? []
    : ["a predicate needs a single unary signature"]),
  ...([A] extends [PredicateParam<F>] ? [] : ["the subject is not assignable to the predicate parameter"]),
]

/** Native predicate narrowing selects assignable alternatives, then falls back to an intersection. */
export type PredicateOf<A, T> =
    unknown extends A ? T
  : [T] extends [A] ? T
  : [Extract<A, T>] extends [never] ? A & T
  : Extract<A, T>

type CheckPredicateSubject<A, T> = [
  ...CheckConcrete<A>,
  ...(unknown extends A ? []
    : true extends IsUnion<T> ? ["a non-unknown predicate subject needs one asserted type"]
    : [T] extends [A] ? []
    : true extends IsUnion<A> ? [Extract<A, T>] extends [never] ? ["a predicate union needs an assignable member"] : []
    : []),
]

export interface PredicateRefinement<T> extends Refinement {
  readonly output: PredicateOf<this["input"], T>
  readonly check: CheckPredicateSubject<this["input"], T>
  readonly negative: unknown extends this["input"] ? unknown : Exclude<this["input"], T>
  readonly negativeCheck: unknown extends this["input"]
    ? unknown extends T ? ["unknown predicate complements cannot assert unknown"]
    : {} extends T ? ["unknown predicate complements cannot assert the empty object type"]
    : [T] extends [NonNullable<T>] ? []
    : ["unknown predicate complements need a non-nullish asserted type"]
    : Equal<this["input"], object> extends true ? []
    : Equal<Extract<this["input"], T>, T> extends true ? []
    : ["predicate complement needs unknown, object, or exact asserted union members"]
}

/** `fn(subject)`; the explicit witness must equal the predicate's asserted type. */
export const predicate = <const F extends Expr.Expr<any>, const E extends Expr.Expr<any>, const T extends Type.Type<any>>(
  fn: F,
  subject: E,
  type: T,
  ..._check: [
    ...CheckPredicate<Expr.Denotes<F>, Expr.Denotes<E>, Type.TypeDenotes<T>>,
    ...CheckPredicateSubject<Expr.Denotes<E>, PredicateType<Expr.Denotes<F>>>,
  ]
): RefinedGuard<
  PredicateOf<Expr.Denotes<E>, PredicateType<Expr.Denotes<F>>>,
  PredicateRefinement<PredicateType<Expr.Denotes<F>>>,
  Expr.Denotes<E>
> => {
  const refine = (input: Type.Type<any>) =>
    isUnknown(input) ? type : Type.Conditional(
      type,
      input,
      type,
      Type.Conditional(
        Type.External("Extract", input, type),
        Type.Never,
        Type.Intersection(input, type),
        Type.External("Extract", input, type),
      ),
    )
  return make(
    subject,
    (value) => Expr.call(fn as Expr.Expr<(value: any) => boolean>, value),
    refine,
    (input) => isUnknown(input) ? Type.Unknown : Type.External("Exclude", input, type),
  )
}

/** Both guards must have the identical subject node; it is saved once when lowered. */
export const allOf = <Out, L extends Refinement, R extends Refinement, A>(
  left: RefinedGuard<Out, L, A>,
  right: RefinedGuard<any, R, any>,
  ..._check: CheckApply<R, Out>
): RefinedGuard<Refined<R, Out>, AndRefinement<L, R>, A> => {
  if (left.subject !== right.subject) throw new Error("Guard.allOf needs guards on the same subject node")
  const refine = (type: Type.Type<any>) => right.refine(left.refine(type))
  return make(
    left.subject,
    (value) => Expr.and(left.test(value), right.test(value)),
    refine,
    (type) => {
      const result = filtered([left.reject(type), right.reject(left.refine(type))])
      const alternatives = members(result) as Type.AnyType[]
      // tsc collapses its synthesized {} | null | undefined false-flow union to unknown.
      return alternatives.some((item) => item.kind === "object" && Object.keys(item.fields).length === 0)
          && alternatives.some((item) => isPrimitive(item, "null"))
          && alternatives.some((item) => isPrimitive(item, "undefined"))
        ? Type.Unknown
        : result
    },
  )
}

type CheckObject<A> = [
  ...CheckConcrete<A>,
  ...([A] extends [object] ? [] : ["a property guard needs an object subject"]),
]
type CheckRecord<A> = [
  ...CheckObject<A>,
  ...([Extract<A, readonly unknown[] | ((...args: any[]) => any)>] extends [never] ? [] : ["array and function property guards are not supported"]),
]
type CheckKey<K extends string> =
    {} extends Record<K, unknown> ? ["a property guard needs one literal key"]
  : true extends IsUnion<K> ? ["a property guard needs one literal key"]
  : []

const objectMembers = (type: Type.Type<any>): Type.Type<any>[] => {
  const node = type as Type.AnyType
  if (node.kind === "union") return node.members.flatMap(objectMembers)
  if (node.kind === "intersection" && node.members.length === 2 && recordKey(node.members[1]!) !== undefined) {
    return objectMembers(node.members[0]).map((member) => Type.Intersection(member, node.members[1]!))
  }
  if (isPrimitive(type, "never")) return []
  if (node.kind === "object" || isPrimitive(type, "object")) return [type]
  throw new Error("a property guard needs concrete object type metadata")
}

const recordKey = (type: Type.Type<any>): string | undefined => {
  const node = type as Type.AnyType
  if (node.kind !== "external" || node.name !== "Record" || node.args.length !== 2) return undefined
  const key = node.args[0] as Type.AnyType
  const value = node.args[1] as Type.AnyType
  return key.kind === "literal" && typeof key.value === "string" && isPrimitive(value, "unknown") ? key.value : undefined
}

const property = (type: Type.Type<any>, key: string): Type.Field | undefined => {
  const node = type as Type.AnyType
  if (node.kind === "object") {
    const field = Object.hasOwn(node.fields, key) ? node.fields[key] : undefined
    return field === undefined ? undefined : Type.fieldOf(field)
  }
  if (node.kind === "intersection") return property(node.members[0], key) ?? property(node.members[1], key)
  return recordKey(type) === key ? Type.fieldOf(Type.Unknown) : undefined
}

export interface OwnRefinement extends Refinement {
  readonly output: this["input"]
  readonly check: CheckObject<this["input"]>
  readonly negative: this["input"]
  readonly negativeCheck: CheckObject<this["input"]>
}

/** `Object.hasOwn` is a boolean test, NOT a TypeScript property narrowing; broad keys are supported. */
export const hasOwn = <const E extends Expr.Expr<object>, const K extends string>(
  subject: E,
  key: K,
  ..._check: CheckObject<Expr.Denotes<E>>
): RefinedGuard<Expr.Denotes<E>, OwnRefinement, Expr.Denotes<E>> => {
  const refine = (type: Type.Type<any>) => type
  return make(
    subject,
    // oxlint-disable-next-line anti-slop/no-object-parameters -- This is the native Object.hasOwn signature, not a stage-1 input boundary.
    (value) => Expr.call(Expr.prop(FFI.hostValue<{ hasOwn: (value: object, key: string) => boolean }>("Object"), "hasOwn"), value, key as string),
    refine,
    refine,
  )
}

type Present<A, K extends string> =
    A extends any ?
      K extends keyof A ? A
    : never
  : never
export type WithKey<A, K extends string> = [Present<A, K>] extends [never] ? A & Record<K, unknown> : Present<A, K>

export interface InRefinement<K extends string> extends Refinement {
  readonly output: WithKey<this["input"], K>
  readonly check: CheckRecord<this["input"]>
  readonly negative: this["input"] extends infer A ? A extends any ? A extends Record<K, unknown> ? never : A : never : never
  readonly negativeCheck: [...CheckRecord<this["input"]>, ...CheckFiniteKeys<this["input"]>]
}

type InfiniteKeys<A> =
    A extends any ?
      string extends keyof A ? A
    : number extends keyof A ? A
    : never
  : never
type CheckFiniteKeys<A> = [InfiniteKeys<A>] extends [never] ? [] : ["a property complement needs finite declared keys"]

/** `key in subject`; unlike hasOwn this includes inherited properties and narrows. */
const in_ = <const E extends Expr.Expr<object>, const K extends string>(
  subject: E,
  key: K,
  ..._check: [...CheckRecord<Expr.Denotes<E>>, ...CheckKey<K>]
): RefinedGuard<WithKey<Expr.Denotes<E>, K>, InRefinement<K>, Expr.Denotes<E>> => {
  const refine = (type: Type.Type<any>) => {
    const known = objectMembers(type).filter((item) => property(item, key) !== undefined)
    return known.length === 0 ? Type.Intersection(type, Type.External("Record", Type.Literal(key), Type.Unknown)) : filtered(known)
  }
  return make(
    subject,
    (value) => Expr.binary("in", key as string, value),
    refine,
    (type) =>
      filtered(
        objectMembers(type).filter((item) => {
          const field = property(item, key)
          return field === undefined || field.optional
        }),
      ),
  )
}

type Discriminant = string | number | boolean
type BadDiscriminant<A, K extends string> =
    A extends Record<K, infer V> ?
      [V] extends [Discriminant] ?
        string extends V ? A
      : number extends V ? A
      : true extends IsUnion<V> ? A
      : V extends string ?
          CheckKey<V> extends [] ? never
        : A
      : never
    : A
  : A
type CheckEq<A, K extends string, L extends Discriminant> = [
  ...CheckRecord<A>,
  ...CheckKey<K>,
  ...(true extends IsUnion<A> ? [] : ["a discriminant guard needs a union subject"]),
  ...([BadDiscriminant<A, K>] extends [never] ? [] : ["every member needs a required single-literal discriminant"]),
  ...(true extends IsUnion<A extends Record<K, infer V> ? V : never> ? [] : ["discriminants must distinguish union members"]),
  ...(true extends IsUnion<L> ? ["a discriminant guard needs one literal value"] : []),
  ...(L extends (A extends Record<K, infer V> ? V : never) ? [] : ["literal does not match a discriminant"]),
]

export interface EqRefinement<K extends string, L extends Discriminant> extends Refinement {
  readonly output: Extract<this["input"], Record<K, L>>
  readonly check: [this["input"]] extends [Record<K, Discriminant>]
    ? [Extract<this["input"], Record<K, L>>] extends [never] ? ["discriminant tests do not overlap"] : []
    : ["a discriminant refinement needs the discriminant property"]
  readonly negative: Exclude<this["input"], Record<K, L>>
  readonly negativeCheck: this["check"]
}

/** Tests a required, single-literal discriminant of a concrete object union. */
export const isEq = <const E extends Expr.Expr<object>, const K extends string, const L extends Discriminant>(
  subject: E,
  key: K,
  literal: L,
  ..._check: CheckEq<Expr.Denotes<E>, K, L>
): RefinedGuard<Extract<Expr.Denotes<E>, Record<K, L>>, EqRefinement<K, L>, Expr.Denotes<E>> => {
  const refine = (type: Type.Type<any>) =>
    filtered(
      objectMembers(type).filter((item) => {
        const field = property(item, key)
        if (field === undefined) throw new Error("a discriminant guard needs the discriminant on every member")
        const { type: value, optional } = Type.fieldOf(field)
        if (optional || value.kind !== "literal") throw new Error("a discriminant guard needs required single-literal fields")
        return (value as Type.Literal).value === literal
      }),
    )
  return make(
    subject,
    (value) => Expr.eq(Expr.prop(value, key as string), literal as Discriminant),
    refine,
    (type) =>
      filtered(
        objectMembers(type).filter((item) => {
          const field = property(item, key)
          if (field === undefined) throw new Error("a discriminant guard needs the discriminant on every member")
          return (field.type as Type.Literal).value !== literal
        }),
      ),
  )
}

export { in_ as in }
