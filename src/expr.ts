import { type Block, materializeBody } from "./block.ts"
import type { FnResult, FnSpec, ImplReturn } from "./declaration.ts"
import { type BindingId, type Checked, type FailedCheck, freshBindingId, isNode, isType, makeNode, type Node, type ValueBinding } from "./node.ts"
import type { NonLoopStatement, Phase, Statement } from "./statement.ts"
import { sameType } from "./types/algebra.ts"
import * as Type from "./types/index.ts"
import {
  type BinaryResult,
  type CheckOperands,
  type ParamBindingType,
  paramBindingType,
  type PropResult,
  typed,
  type UnaryResult,
  type WidenFresh,
} from "./typing.ts"

declare const ExprTypeId: unique symbol

/** an expression node; `A` is the TypeScript type of the value it denotes, `type` is that type as data when known */
export interface Expr<A = unknown> extends Node {
  readonly [ExprTypeId]?: A
  readonly type?: Type.Type<any> | undefined
}

export type Denotes<E extends Expr<any>> = E extends Expr<infer A> ? A : never

type LiftValue = string | number | boolean

/** what may stand for a value of type `A`: a node, or a plain value that lifts to one */
export type In<A> = Expr<A> | Liftable<A>

type StringKeyed<A> = Extract<keyof A, symbol> extends never ? A : never

type SeenType<T, Seen extends readonly unknown[]> =
    Seen extends readonly [infer Head, ...infer Tail] ?
      [T] extends [Head] ?
        Type.Equal<T, Head> extends true ? true
      : SeenType<T, Tail>
    : SeenType<T, Tail>
  : false

// oxlint-disable-next-line typescript/no-wrapper-object-types -- Object must be rejected alongside object and {}.
type IsErasedObject<T> = [keyof T] extends [never] ? SeenType<T, [{}, object]> : SeenType<T, [Object]>

type LiftableOne<A> =
    [A] extends [LiftValue] ? Extract<A, LiftValue>
  : [A] extends [(...a: any[]) => any] ? never
  : [A] extends [readonly (infer E)[]] ? readonly In<E>[]
  : [A] extends [object] ?
      StringKeyed<A> extends never ? never
    : { [K in keyof A]: In<A[K]> }
  : never

type Liftable<A> = A extends any ? LiftableOne<A> : never

type LiftEach<T extends readonly unknown[]> = { -readonly [K in keyof T]: Lift<T[K]> }

/**
 * The node a value lifts to. Keeping the node, rather than only what it denotes,
 * is what lets a declaration tell a fresh literal from a declared one.
 */
export type Lift<T> =
    T extends FailedCheck ? never
  : T extends Expr<any> ? T
  : IsErasedObject<T> extends true ? never
  : T extends LiftValue ? LiteralExpr<T>
  : T extends (...args: any[]) => any ? never
  : T extends readonly unknown[] ? ArrayExpr<Extract<LiftEach<T>, Expr<any>[]>>
  : T extends object ?
      StringKeyed<T> extends never ? never
    : ObjectExpr<{ readonly [K in keyof T]: Lift<T[K]> }>
  : never

/** the type a value denotes once lifted; function types are preserved */
export type Value<T> = T extends (...args: any[]) => any ? T : Denotes<Lift<T>>

/** object literals checked against a written annotation keep the original field expressions in view */
export type ContextualValue<E> =
    E extends ObjectExpr<infer F> ? { -readonly [K in keyof F]: ContextualValue<F[K]> }
  : E extends ArrayExpr<infer Elements> ? { -readonly [K in keyof Elements]: ContextualValue<Elements[K]> }
  : E extends Expr<infer A> ? A
  : never

type FreshTargetValue<E> =
    E extends ObjectExpr<infer F> ? { -readonly [K in keyof F]: FreshTargetValue<F[K]> }
  : E extends ArrayExpr<infer Elements> ? { -readonly [K in keyof Elements]: FreshTargetValue<Elements[K]> }
  : E extends Cond<any, infer Then, infer Else> ? FreshTargetValue<Then> | FreshTargetValue<Else>
  : ContextualValue<E>

type MatchingTargets<E, A> = A extends unknown ? ([FreshTargetValue<E>] extends [A] ? A : never) : never
type TargetKeys<A> = A extends unknown ? keyof A : never
type TargetField<A, K> = A extends unknown ? (K extends keyof A ? A[K] : never) : never
type ElementTarget<A, K> = K extends `${infer N extends number}` ? TargetField<A, N> : TargetField<A, K>
type ExcessTargetFields<E, A, Seen extends readonly unknown[] = []> =
    unknown extends A ? never
  : IsErasedObject<A> extends true ? never
  : SeenType<A, Seen> extends true ? never
  : E extends Cond<any, infer Then, infer Else> ? ExcessTargetFields<Then, A, Seen> | ExcessTargetFields<Else, A, Seen>
  : E extends ObjectExpr<infer F> ?
      Exclude<keyof F, TargetKeys<MatchingTargets<E, A>>> extends infer Extra ?
        [Extra] extends [never] ? { [K in keyof F]-?: ExcessTargetFields<F[K], TargetField<MatchingTargets<E, A>, K>, [...Seen, A]> }[keyof F]
      : ["object literal has excess properties", Extra]
    : never
  : E extends ArrayExpr<infer Elements> ? { [K in keyof Elements]: ExcessTargetFields<Elements[K], ElementTarget<A, K>, [...Seen, A]> }[number]
  : never

/** Already-assignable denotations need no fresh re-expansion (notably recursive records). */
export type CheckContextual<E extends Expr<any>, A> =
    [Denotes<E>] extends [A] ? []
  : [FreshTargetValue<E>] extends [A] ?
      [ExcessTargetFields<E, A>] extends [never] ? []
    : Extract<ExcessTargetFields<E, A>, unknown[]>
  : ["the value", FreshTargetValue<E>, "is not assignable to", A]

type ValidStructuralLiftProof = true | readonly ValidStructuralLiftProof[] | { readonly [key: string]: ValidStructuralLiftProof }

type StructuralLiftProof<T> =
    Type.IsAny<T> extends true ? true
  : T extends FailedCheck ? false
  : T extends Expr<any> ? true
  : T extends LiftValue ? true
  : IsErasedObject<T> extends true ? false
  : T extends (...args: any[]) => any ? false
  : T extends readonly unknown[] ? { readonly [K in keyof T]-?: StructuralLiftProof<Required<T>[K]> }
  : T extends object ?
      StringKeyed<T> extends never ? false
    : { readonly [K in keyof T]-?: StructuralLiftProof<Required<T>[K]> }
  : false

export type CheckLiftable<T> =
    Type.IsAny<T> extends true ? []
  : [T] extends [Expr<any>] ? []
  : [T] extends [LiftValue] ? []
  : [StructuralLiftProof<T>] extends [ValidStructuralLiftProof] ? []
  : ["cannot lift", T]

type CheckElements<T extends readonly unknown[]> =
    T extends readonly [infer Head, ...infer Tail extends readonly unknown[]] ?
      CheckLiftable<Head> extends [] ? CheckElements<Tail>
    : CheckLiftable<Head>
  : CheckLiftable<T[number]>

type FailingFields<F> =
    keyof F extends infer K ?
      K extends keyof F ?
        CheckLiftable<F[K]> extends [] ? never
      : CheckLiftable<F[K]>
    : never
  : never

type CheckFields<F> = [FailingFields<F>] extends [never] ? [] : FailingFields<F>

type RecursiveLiftDiagnostic<T, Seen extends readonly unknown[] = []> =
    Type.IsAny<T> extends true ? never
  : T extends Exclude<FailedCheck, undefined> ? ["cannot lift", T]
  : T extends Expr<any> ? never
  : IsErasedObject<T> extends true ? ["cannot lift a value typed", T]
  : SeenType<T, Seen> extends true ? never
  : T extends readonly unknown[] ? RecursiveLiftDiagnostic<T[number], [...Seen, T]>
  : T extends object ? { [K in keyof T]-?: RecursiveLiftDiagnostic<T[K], [...Seen, T]> }[keyof T]
  : never

export type CheckLift<T> =
    Type.IsAny<T> extends true ? []
  : [T] extends [Expr<any>] ? []
  : [T] extends [LiftValue] ? []
  : [RecursiveLiftDiagnostic<T>] extends [never] ?
      [T] extends [In<Value<T>>] ? []
    : ["cannot lift", T]
  : Extract<RecursiveLiftDiagnostic<T>, unknown[]>

const plainFields = <F extends { readonly [key: string]: unknown }>(fields: F): Array<readonly [string, unknown]> => {
  if (Object.getPrototypeOf(fields) !== Object.prototype) {
    throw new Error(`fields must be a plain object literal with Object.prototype`)
  }
  const descriptors = Object.getOwnPropertyDescriptors(fields)
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) {
    throw new Error(`fields must not have symbol keys`)
  }
  const entries: Array<readonly [string, unknown]> = []
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) throw new Error(`field "${key}" must be enumerable`)
    if (!("value" in descriptor)) throw new Error(`field "${key}" must be a data property, not an accessor`)
    entries.push([key, descriptor.value])
  }
  return entries
}

/** lifts a plain value to a node; a value node passes through */
export const lift = <const X>(x: X, ..._check: CheckLiftable<X>): Lift<X> => {
  if (isNode(x) && !isType(x)) return x as unknown as Lift<X>
  if (typeof x === "string") return string(x) as unknown as Lift<X>
  if (typeof x === "number") return number(x) as unknown as Lift<X>
  if (typeof x === "boolean") return boolean(x) as unknown as Lift<X>
  if (globalThis.Array.isArray(x)) return array(...(x as never[])) as unknown as Lift<X>
  if (x !== null && typeof x === "object") {
    return object(x as never) as unknown as Lift<X>
  }
  throw new Error(`cannot lift ${x === null ? "null" : typeof x}`)
}

/**
 * A reference to a binding, by its id. `nameHint` is what the binding asked to
 * be called. `mutable` says whether assignment accepts it. `fresh` says
 * whether the binding is an unannotated `const` holding a fresh literal.
 */
export interface Ref<
  A = unknown,
  Mutable extends boolean = boolean,
  Fresh extends boolean = false,
  TypeParams extends Type.AnyTypeParams = [],
> extends Expr<A>, ValueBinding {
  readonly kind: "ref"
  readonly id: BindingId
  readonly nameHint: string
  readonly mutable: Mutable
  readonly fresh: Fresh
  readonly typeParams: TypeParams
  readonly type?: Type.Type<A> | undefined
}

export const ref = <A, Mutable extends boolean, Fresh extends boolean, TypeParams extends Type.AnyTypeParams = []>(
  id: BindingId,
  nameHint: string,
  type: Type.Type<A> | undefined,
  mutable: Mutable,
  fresh: Fresh,
  typeParams?: TypeParams,
): Ref<A, Mutable, Fresh, TypeParams> =>
  makeNode({
    kind: "ref",
    id,
    nameHint,
    mutable,
    fresh,
    typeParams: (typeParams ?? []) as TypeParams,
    type,
  })

/**
 * A host value the program uses but does not declare: an import when it has a
 * `source`, a global otherwise. It is named by `name`, which is never renamed,
 * and the type argument is all the program knows about it.
 */
export interface ExternalExpr<A = unknown> extends Expr<A> {
  readonly kind: "external"
  readonly name: string
  readonly source?: string | undefined
}

export const external = <A>(name: string, source: string | undefined): ExternalExpr<A> => makeNode({ kind: "external", name, source })

type LiteralValue = string | number | boolean | null

export interface LiteralExpr<Value extends LiteralValue> extends Expr<Value> {
  readonly kind: "literal"
  readonly value: Value
  readonly type: Type.Literal<Value>
}

const literalExpr = <const Value extends LiteralValue>(value: Value): LiteralExpr<Value> => {
  if (typeof value === "number" && !globalThis.Number.isFinite(value)) {
    throw new Error(`expression number must be finite, got ${globalThis.String(value)}`)
  }
  return makeNode({ kind: "literal", value, type: Type.Literal(value) }) as LiteralExpr<Value>
}

export const string = <const Value extends string>(value: Value): LiteralExpr<Value> => literalExpr(value)
export const number = <const Value extends number>(value: Value): LiteralExpr<Value> => literalExpr(value)
export const boolean = <const Value extends boolean>(value: Value): LiteralExpr<Value> => literalExpr(value)
const null_ = (): LiteralExpr<null> => literalExpr(null)

export interface ExprFields {
  readonly [key: string]: Expr<any>
}

export type ObjectExprFields<F extends ExprFields> = {
  -readonly [K in keyof F]: WidenFresh<F[K]>
}

export interface ObjectExpr<F extends ExprFields = ExprFields> extends Expr<ObjectExprFields<F>> {
  readonly kind: "object"
  readonly fields: F
  readonly type?: Type.Object | undefined
}

export const object = <const F extends Record<string, unknown>>(
  fields: F & Checked<CheckFields<F>>,
): ObjectExpr<{ readonly [K in keyof F]: Lift<F[K]> }> => {
  const entries = plainFields(fields).map(([key, value]) => [key, lift(value as never)])
  return typed({ kind: "object", fields: globalThis.Object.fromEntries(entries) }) as ObjectExpr<{ readonly [K in keyof F]: Lift<F[K]> }>
}

export interface Prop<O extends Expr<any>, K extends string> extends Expr<K extends keyof Denotes<O> ? PropResult<Denotes<O>, K> : never> {
  readonly kind: "prop"
  readonly object: O
  readonly key: K
  readonly type?: Type.Type<any> | undefined
}

export const prop = <const O, const K extends string & keyof Value<O>>(
  object: O,
  key: K,
  ..._check: CheckLiftable<O>
): Prop<Extract<Lift<O>, Expr<any>>, K> => {
  return typed({ kind: "prop", object: lift(object as never), key }) as Prop<Extract<Lift<O>, Expr<any>>, K>
}

export const checkedProp = <A>(object: Expr<unknown>, key: string, expected: Type.Type<A>): Expr<A> => {
  const type = object.type as Type.AnyType | undefined
  if (type?.kind !== "object") throw new Error(`checkedProp requires concrete object metadata for "${key}"`)
  if (!globalThis.Object.hasOwn(type.fields, key)) throw new Error(`checkedProp cannot find own field "${key}"`)
  const entry = type.fields[key]
  if (entry === undefined) throw new Error(`checkedProp cannot find field metadata for "${key}"`)
  const field = Type.fieldOf(entry)
  if (field.optional) throw new Error(`checkedProp cannot read optional field "${key}" as required`)
  if (!sameType(field.type, expected)) throw new Error(`checkedProp type witness does not match field "${key}"`)
  return makeNode({ kind: "prop", object, key, type: expected })
}

// As for optional properties, indexed reads include implicit undefined but
// writes accept it only when the element explicitly declares it.
type IndexWriters<O extends readonly unknown[], N extends number> = N extends keyof O ? (value: Required<Pick<O, N>>[N]) => void : never

/** A finite set of possible positions must all accept a write; a broad number uses the element type. */
export type IndexWriteType<O extends readonly unknown[], I extends Expr<number>> =
    number extends Denotes<I> ? O[number]
  : IndexWriters<O, Denotes<I>> extends (value: infer Value) => void ? Value
  : never

type IndexResult<O extends readonly unknown[], I extends Expr<number>> =
    number extends O["length"] ? O[number] | undefined
  : number extends Denotes<I> ? O[number] | undefined
  : O[Denotes<I>]

type TupleKeys<O extends readonly unknown[]> = Exclude<keyof O, keyof any[]>
type CheckIndex<O extends readonly unknown[], I extends Expr<number>> =
    number extends O["length"] ? []
  : number extends Denotes<I> ? []
  : `${Denotes<I>}` extends TupleKeys<O> ? []
  : ["tuple index is out of range", Denotes<I>]

export interface Index<O extends Expr<readonly unknown[]>, I extends Expr<number>> extends Expr<IndexResult<Denotes<O>, I>> {
  readonly kind: "index"
  readonly object: O
  readonly index: I
  readonly type?: Type.Type<any> | undefined
}

export const index = <const O extends In<readonly unknown[]>, const I extends In<number>>(
  object: O,
  at: I,
  ..._check: [...CheckLiftable<O>, ...CheckLiftable<I>, ...CheckIndex<Value<O> extends readonly unknown[] ? Value<O> : never, Lift<I>>]
): Index<Extract<Lift<O>, Expr<readonly unknown[]>>, Extract<Lift<I>, Expr<number>>> => {
  return typed({ kind: "index", object: lift(object as never), index: lift(at as never) }) as Index<
    Extract<Lift<O>, Expr<readonly unknown[]>>,
    Extract<Lift<I>, Expr<number>>
  >
}

/** an element is inferred the way a `let` would infer it */
export interface ArrayExpr<Elements extends Expr<any>[]> extends Expr<WidenFresh<Elements[number]>[]> {
  readonly kind: "array"
  readonly elements: Elements
  readonly type?: Type.Array<any> | undefined
}

type LiftedElements<Elements extends readonly unknown[]> = Extract<LiftEach<Elements>, Expr<any>[]>

export const array = <const Elements extends readonly unknown[]>(
  ...elements: Elements & Checked<CheckElements<Elements>>
): ArrayExpr<LiftedElements<Elements>> => {
  const lifted = (elements as readonly unknown[]).map((element) => lift(element as never))
  return typed({ kind: "array", elements: lifted }) as ArrayExpr<LiftedElements<Elements>>
}

export type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "&&" | "||" | "in" | "instanceof"

export interface Binary<Op extends BinaryOperator, L extends Expr<any>, R extends Expr<any>> extends Expr<BinaryResult<Op, Denotes<L>, Denotes<R>>> {
  readonly kind: "binary"
  readonly op: Op
  readonly left: L
  readonly right: R
  readonly type?: Type.Type<any> | undefined
}

export const binary = <const Op extends BinaryOperator, const L, const R>(
  op: Op,
  left: L,
  right: R,
  ..._check: [...CheckLiftable<L>, ...CheckLiftable<R>, ...CheckOperands<Op, Value<L>, Value<R>>]
): Binary<Op, Lift<L>, Lift<R>> =>
  typed({ kind: "binary", op, left: lift(left as never), right: lift(right as never) }) as Binary<Op, Lift<L>, Lift<R>>

const operator = <const Op extends BinaryOperator>(op: Op) =>
<const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLiftable<L>, ...CheckLiftable<R>, ...CheckOperands<Op, Value<L>, Value<R>>]
): Binary<Op, Lift<L>, Lift<R>> => binary(op, left, right, ..._check as never)

export const add = operator("+")
export const sub = operator("-")
export const mul = operator("*")
export const div = operator("/")
export const mod = operator("%")
export const eq = operator("===")
export const neq = operator("!==")
export const lt = operator("<")
export const lte = operator("<=")
export const gt = operator(">")
export const gte = operator(">=")
export const and = operator("&&")
export const or = operator("||")

export type UnaryOperator = "!" | "typeof"

export interface Unary<Op extends UnaryOperator, E extends Expr<any>> extends Expr<UnaryResult<Op>> {
  readonly kind: "unary"
  readonly op: Op
  readonly operand: E
  readonly type?: Type.Type<any> | undefined
}

export const unary = <const Op extends UnaryOperator, const E>(
  op: Op,
  operand: E,
  ..._check: CheckLiftable<E>
): Unary<Op, Lift<E>> => {
  return typed({ kind: "unary", op, operand: lift(operand as never) }) as Unary<Op, Lift<E>>
}

export const not = <const E>(operand: E, ..._check: CheckLiftable<E>): Unary<"!", Lift<E>> => unary("!", operand, ..._check as never)
const typeof_ = <const E>(operand: E, ..._check: CheckLiftable<E>): Unary<"typeof", Lift<E>> => unary("typeof", operand, ..._check as never)

export interface TemplateExpr extends Expr<string> {
  readonly kind: "template"
  readonly parts: readonly string[]
  readonly exprs: Expr<any>[]
  readonly type?: Type.Type<string> | undefined
}

export const template = <const Parts extends readonly string[], const Exprs extends readonly unknown[]>(
  parts: Parts,
  ...exprs: Exprs & Checked<CheckElements<Exprs>>
): TemplateExpr => {
  if (parts.length !== exprs.length + 1) {
    throw new Error(`a template with ${exprs.length} exprs needs ${exprs.length + 1} parts, got ${parts.length}`)
  }
  return typed({ kind: "template", parts, exprs: exprs.map((expr) => lift(expr as never)) }) as TemplateExpr
}

export interface Cond<C extends Expr<any>, T extends Expr<any>, E extends Expr<any>> extends Expr<Denotes<T> | Denotes<E>> {
  readonly kind: "cond"
  readonly condition: C
  readonly then: T
  readonly else: E
  readonly type?: Type.Type<any> | undefined
}

export type CheckBoolean<T> = [Value<T>] extends [boolean] ? [] : ["condition must be boolean", Value<T>]

export const cond = <const C, const T, const E>(
  condition: C,
  then: T,
  else_: E,
  ..._check: [...CheckLiftable<C>, ...CheckBoolean<C>, ...CheckLiftable<T>, ...CheckLiftable<E>]
): Cond<Lift<C>, Lift<T>, Lift<E>> => {
  return typed({ kind: "cond", condition: lift(condition as never), then: lift(then as never), else: lift(else_ as never) }) as Cond<
    Lift<C>,
    Lift<T>,
    Lift<E>
  >
}

export type ParamForm = "required" | "optional" | "rest"

/** a rest param is declared by its element type: `rest("tags", string)` is `...tags: string[]` */
export interface Param<Name extends string = string, A = unknown, Form extends ParamForm = "required"> extends ValueBinding {
  readonly kind: "param"
  readonly id: BindingId
  readonly nameHint: Name
  readonly type: Type.Type<A>
  readonly form: Form
}

export type AnyParam = Param<string, any, ParamForm>
export type AnyParams = AnyParam[]

const makeParam = <Name extends string, A, Form extends ParamForm>(
  form: Form,
  nameHint: Name,
  type: Type.Type<A>,
): Param<Name, A, Form> => makeNode({ kind: "param", id: freshBindingId(), nameHint, type, form })

export const param = <const Name extends string, A>(nameHint: Name, type: Type.Type<A>): Param<Name, A> => makeParam("required", nameHint, type)

export const optional = <const Name extends string, A>(nameHint: Name, type: Type.Type<A>): Param<Name, A, "optional"> =>
  makeParam("optional", nameHint, type)

export const rest = <const Name extends string, A>(nameHint: Name, type: Type.Type<A>): Param<Name, A, "rest"> => makeParam("rest", nameHint, type)

/** the argument tuple a parameter list accepts */
export type PlainParams<Params extends AnyParams> =
    Params extends [infer Head extends Param<string, any, any>, ...infer Tail extends AnyParams] ?
      Head extends Param<any, infer A, infer Form> ?
        Form extends "rest" ? [...A[]]
      : Form extends "optional" ? [item?: A | undefined, ...rest: PlainParams<Tail>]
      : [A, ...PlainParams<Tail>]
    : never
  : []

/** the refs an implementation receives, keyed by parameter name */
export type ParamBindings<Params extends AnyParams> = {
  readonly [P in Params[number] as P["nameHint"]]: P extends Param<any, infer A, infer Form> ? Ref<ParamBindingType<A, Form>, true, false> : never
}

export const paramBindings = <Params extends AnyParams>(params: Params): ParamBindings<Params> => {
  const names = new Set<string>()
  for (const param of params) {
    if (names.has(param.nameHint)) throw new Error(`duplicate parameter name "${param.nameHint}"`)
    names.add(param.nameHint)
  }
  return globalThis.Object.fromEntries(
    params.map((item) => [item.nameHint, ref(item.id, item.nameHint, paramBindingType(item), true, false)]),
  ) as unknown as ParamBindings<Params>
}

type IsNameUnion<Name, Whole = Name> =
    Name extends unknown ?
      [Whole] extends [Name] ? false
    : true
  : never
type CheckParamName<Name extends string> =
    string extends Name ? ["parameter name must be a single string literal", Name]
  : true extends IsNameUnion<Name> ? ["parameter name must be a single string literal", Name]
  : [Name] extends [never] ? ["parameter name must be a single string literal", Name]
  : []

type ListNameChecks<P> = P extends AnyParam ? CheckParamName<P["nameHint"]> : []

/** single-literal names, unique per signature; nothing required after optional or rest */
export type CheckParams<Params extends AnyParams, SeenOptional extends boolean = false, SeenNames extends string = never> =
    Params extends [infer Head extends AnyParam, ...infer Tail extends AnyParams] ?
      CheckParamName<Head["nameHint"]> extends [] ?
        Head["nameHint"] extends SeenNames ? ["duplicate parameter name", Head["nameHint"]]
      : Head["form"] extends "rest" ?
          Tail extends [] ? []
        : ["a rest parameter must be last", Head["nameHint"]]
      : Head["form"] extends "optional" ? CheckParams<Tail, true, SeenNames | Head["nameHint"]>
      : SeenOptional extends true ? ["a required parameter cannot follow an optional one", Head["nameHint"]]
      : CheckParams<Tail, false, SeenNames | Head["nameHint"]>
    : CheckParamName<Head["nameHint"]>
  : [Exclude<ListNameChecks<Params[number]>, []>] extends [never] ? []
  : Exclude<ListNameChecks<Params[number]>, []>

export interface GenericSignature<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyTypeParams = Type.AnyTypeParams,
> {
  readonly typeParams: TypeParams
  readonly params: Params
  readonly return: Return
}

/** the ref a function declaration hands back: a generic one has to be instantiated before it can be called */
export type FnRef<Params extends AnyParams, Return, TypeParams extends Type.AnyTypeParams> = TypeParams extends []
  ? Ref<(...args: PlainParams<Params>) => Return, false, false, []>
  : Ref<GenericSignature<Params, Return, TypeParams>, false, false, TypeParams>

export interface CallExpr<Args extends Expr<any>[] = Expr<any>[], Return = unknown> extends Expr<Return> {
  readonly kind: "call"
  readonly callee: Expr<any>
  readonly args: Args
  readonly type?: Type.Type<any> | undefined
}

type ArgumentErrors<P extends readonly unknown[], Args extends readonly unknown[]> = Exclude<
  { [K in keyof Args]: CheckContextual<Lift<Args[K]>, ElementTarget<P, K>> }[number],
  []
>
type CheckArguments<P extends readonly unknown[], Args extends readonly unknown[]> = [ArgumentErrors<P, Args>] extends [never] ? []
  : ArgumentErrors<P, Args>

export const call = <P extends readonly unknown[], R, const Args extends readonly unknown[]>(
  callee: Expr<(...args: P) => R>,
  ...args: Args & { [K in keyof P]: In<P[K]> | Expr<any> } & Checked<CheckElements<Args>> & Checked<CheckArguments<P, Args>>
): CallExpr<Expr<any>[], R> => typed({ kind: "call", callee, args: args.map((arg) => lift(arg as never)) }) as CallExpr<Expr<any>[], R>

export type InstantiateParams<Params extends AnyParams, TypeParams extends Type.AnyTypeParams, TypeArgs extends Type.Type<any>[]> = {
  [K in keyof Params]: Params[K] extends Param<infer Name, infer A, infer Form>
    ? Param<Name, Type.Substitute<A, TypeParams, Type.ArgTypes<TypeArgs>>, Form>
    : never
}

export interface Instantiation<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyTypeParams = Type.AnyTypeParams,
  TypeArgs extends Type.Type<any>[] = Type.Type<any>[],
> extends
  Expr<(...args: PlainParams<InstantiateParams<Params, TypeParams, TypeArgs>>) => Type.Substitute<Return, TypeParams, Type.ArgTypes<TypeArgs>>>
{
  readonly kind: "instantiation"
  readonly callee: Expr<GenericSignature<Params, Return, TypeParams>> & { readonly typeParams: TypeParams }
  readonly typeArgs: TypeArgs
  readonly type?: Type.Function | undefined
}

type CheckTypeArgs<TypeParams extends Type.AnyTypeParams, TypeArgs extends Type.Type<any>[]> =
    Type.CheckTypeArgs<TypeParams, TypeArgs> extends infer Check ?
      Check extends Type.ArityError<any, any> | Type.ConstraintError<any, any, any> ? [Check]
    : TypeArgs
  : never

export const instantiate = <Params extends AnyParams, Return, TypeParams extends Type.AnyTypeParams, TypeArgs extends Type.Type<any>[]>(
  callee: Expr<GenericSignature<Params, Return, TypeParams>> & { readonly typeParams: TypeParams },
  ...typeArgs: CheckTypeArgs<TypeParams, TypeArgs>
): Instantiation<Params, Return, TypeParams, TypeArgs> =>
  typed({ kind: "instantiation", callee, typeArgs: typeArgs as Type.Type<any>[] }) as Instantiation<Params, Return, TypeParams, TypeArgs>

export interface Arrow<Params extends AnyParams = AnyParams, Return = unknown, P extends Phase = Phase, TypeParams extends Type.AnyTypeParams = []>
  extends Expr<TypeParams extends [] ? (...args: PlainParams<Params>) => Return : GenericSignature<Params, Return, TypeParams>>
{
  readonly kind: "arrow"
  readonly typeParams: TypeParams
  readonly params: Params
  readonly returnType?: Type.Type<Return> | undefined
  readonly body: Block<Statement<P>>
  readonly type?: Type.Function | undefined
}

/** unlike a declaration, an arrow's body runs at construction */
export const arrow = <
  const Params extends AnyParams = [],
  Declared extends Type.Type<any> | undefined = undefined,
  const TypeParams extends Type.AnyTypeParams = [],
  Yields extends NonLoopStatement = NonLoopStatement,
  const Final = unknown,
>(
  spec: FnSpec<Params, Declared, TypeParams, Yields, Final> & Checked<CheckParams<Params>> & Checked<Type.CheckTypeParamNames<TypeParams>>,
): FnResult<Params, Declared, TypeParams, Yields, Final, Arrow<Params, ImplReturn<Declared, Final, Yields>, Phase, TypeParams>> => {
  const params = (spec.params ?? []) as Params
  return typed({
    kind: "arrow",
    params,
    typeParams: spec.typeParams ?? [],
    returnType: spec.returns,
    body: materializeBody(() => spec.body(paramBindings(params))),
  }) as FnResult<Params, Declared, TypeParams, Yields, Final, Arrow<Params, ImplReturn<Declared, Final, Yields>, Phase, TypeParams>>
}

/** an expression whose type follows from its children */
export type Composite<P extends Phase = Phase> = Exclude<AnyExpr<P>, Ref<any, any, any, any> | ExternalExpr<any> | LiteralExpr<LiteralValue>>

/** every expression node */
export type AnyExpr<P extends Phase = Phase> =
  | Ref<any, any, any, any>
  | ExternalExpr<any>
  | LiteralExpr<LiteralValue>
  | Prop<Expr<any>, string>
  | Index<Expr<readonly unknown[]>, Expr<number>>
  | ObjectExpr
  | ArrayExpr<any>
  | Binary<BinaryOperator, Expr<any>, Expr<any>>
  | Unary<UnaryOperator, Expr<any>>
  | TemplateExpr
  | Cond<Expr<any>, Expr<any>, Expr<any>>
  | CallExpr<Expr<any>[], any>
  | Instantiation<AnyParams, any, Type.AnyTypeParams, Type.Type<any>[]>
  | Arrow<AnyParams, any, P, Type.AnyTypeParams>

export { null_ as null, typeof_ as typeof }
