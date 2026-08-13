import { callsiteName, callsiteParamNames } from "./callsite.ts"
import { NODE } from "./norm.ts"
import { NodeBrand } from "./pipeable.ts"
import * as Type from "./types/index.ts"
import type { Abstract, Apply as ApplyType, Substitute } from "./types/machinery.ts"
import * as Primitive from "./types/nodes/primitive.ts"

/**
 * the type-level mirror of norm: TypeExpr nodes pass through, raw literals
 * become Literal types, arrays become Tuples, plain objects become Object
 * types. `{ ok: true, value: T }` replaces
 * `Type.Object({ ok: Type.Literal(true), value: T })`.
 */

/** phantom carrier for the type-level surface, so tderef is lossless */
declare const TSurfaceId: unique symbol
interface TBase<A> {
  readonly [TSurfaceId]?: A
}

/** tnorm's type-level half: the denoted type of anything tnorm accepts */
export type TDenote<X> =
    X extends Type.TypeExpr<infer A> ? A
  : X extends TBase<infer A> ? A
  : X extends string | number | boolean | null ? X
  : X extends readonly unknown[] ? { -readonly [K in keyof X]: TDenote<X[K]> }
  : X extends object ? { -readonly [K in keyof X]: TDenote<X[K]> }
  : never

type ValidType<X, Depth extends readonly unknown[] = []> = 0 extends 1 & X ? true // any is always fine
  : Depth extends { length: 10 } ? true // bail out on deep shapes; assume fine
  : X extends Type.TypeExpr<any> ? true
  : X extends TBase<any> ? true
  : X extends string | number | boolean | null ? true
  : X extends readonly (infer E)[] ? ValidType<E, [...Depth, 0]>
  : X extends object ? ValidType<X[keyof X], [...Depth, 0]>
  : false

/** liftability as a rest-param check, mirroring CheckLift */
export type CheckType<X> = [ValidType<X>] extends [true] ? [] : ["cannot lift to a type", X]

type CheckEach<M extends readonly unknown[]> = { [K in keyof M]: ValidType<M[K]> extends true ? M[K] : ["cannot lift to a type", M[K]] }

export const tnorm = <const X>(x: X, ..._check: CheckType<X>): Type.TypeExpr<TDenote<X>> => {
  const stashed = (x as any)?.[NODE]
  if (stashed !== undefined) return stashed
  if ((x as any)?.[NodeBrand] !== undefined) return x as Type.TypeExpr<TDenote<X>>
  if (x === null) return Type.Literal(null) as unknown as Type.TypeExpr<TDenote<X>>
  if (typeof x === "string" || typeof x === "number" || typeof x === "boolean") {
    return Type.Literal(x) as unknown as Type.TypeExpr<TDenote<X>>
  }
  if (Array.isArray(x)) return Type.Tuple(...x.map((v) => tnorm(v))) as unknown as Type.TypeExpr<TDenote<X>>
  if (typeof x === "object") {
    return Type.Object(Object.fromEntries(Object.entries(x).map(([key, value]) => [key, tnorm(value)]))) as unknown as Type.TypeExpr<
      TDenote<X>
    >
  }
  throw new Error(`cannot lift ${typeof x} to a type`)
}

/** pre-made primitive nodes — `$.T.string` replaces `Type.String()` */
export const T = {
  string: Primitive.String(),
  number: Primitive.Number(),
  boolean: Primitive.Boolean(),
  undefined: Primitive.Undefined(),
  null: Primitive.Null(),
  void: Primitive.Void(),
  never: Primitive.Never(),
  unknown: Primitive.Unknown(),
  any: Primitive.Any(),
} as const

/** a union type from tnorm'd members: `$.union({ ok: true, value: T }, { ok: false, error: E })` */
export const union = <const M extends [unknown, unknown, ...unknown[]]>(
  ...members: CheckEach<M>
): Type.Union<{ [K in keyof M]: Type.TypeExpr<TDenote<M[K]>> }> =>
  Type.Union(...(members as readonly unknown[]).map((member) => tnorm(member as any)) as any) as any

/** type application with tnorm'd args: `$.apply(Result, [$.T.string, $.T.number])` */
export const apply = <Callee extends Type.TypeExpr<any>, const Args extends unknown[]>(
  callee: Callee,
  args: CheckEach<Args>,
): Type.Application<ApplyType<Callee, { [K in keyof Args]: Type.TypeExpr<TDenote<Args[K]>> }>> =>
  Type.Apply(callee, (args as readonly unknown[]).map((arg) => tnorm(arg as any)) as any) as any

type ParamsOf<Names extends readonly string[]> = Names extends readonly [infer Head extends string, ...infer Tail extends string[]]
  ? [Type.Param<Head, any>, ...ParamsOf<Tail>]
  : []

const makeParams = (names: readonly string[]): Type.AnyParams => names.map((name) => Type.Param(name))

/**
 * a whole type declaration in one call — name from the callsite, params from a
 * string array (precise) or parsed from the callback arrow (convenient, but the
 * resulting ref denotes `any`). the body tnorms.
 *
 *   $.type((T, E) => $.union({ ok: true, value: T }, { ok: false, error: E }))
 */
export function type<const Names extends readonly string[], const Body>(
  params: Names,
  fn: (...args: ParamsOf<Names>) => Body,
): Type.TypeBuilder<TDenote<Body>, ParamsOf<Names>>
export function type<const F extends (...args: any[]) => any>(fn: F): Type.TypeBuilder<TDenote<ReturnType<F>>, any>
export function type<const Body>(body: Body): Type.TypeBuilder<TDenote<Body>, []>
export function type<const Name extends string, const Names extends readonly string[], const Body>(
  name: Name,
  params: Names,
  fn: (...args: ParamsOf<Names>) => Body,
): Type.TypeBuilder<TDenote<Body>, ParamsOf<Names>>
export function type<const Name extends string, const F extends (...args: any[]) => any>(
  name: Name,
  fn: F,
): Type.TypeBuilder<TDenote<ReturnType<F>>, any>
export function type<const Name extends string, const Body>(
  name: Name,
  body: Body,
): Type.TypeBuilder<TDenote<Body>, []>
export function type(...args: Array<any>): Type.TypeBuilder<any, any> {
  const [name, rest] = (typeof args[0] === "string" ? [args[0], args.slice(1)] : [callsiteName(type), args]) as [string, Array<any>]
  // texpr surfaces are function proxies so the apply trap can fire; they are
  // nodes (NODE is set), not declaration callbacks
  if (rest.length === 1 && (rest[0]?.[NODE] !== undefined || rest[0]?.[NodeBrand] !== undefined)) {
    return Type.Type(name).pipe(Type.Body(tnorm(rest[0])))
  }
  if (rest.length === 1 && typeof rest[0] === "function") {
    const params = makeParams(callsiteParamNames(type))
    return Type.Type(name).pipe(Type.TypeParams(...params), Type.Body(tnorm(rest[0](...params) as any)))
  }
  if (rest.length === 2) {
    const [names, fn] = rest as [readonly string[], (...args: Array<any>) => unknown]
    const params = makeParams(names)
    return Type.Type(name).pipe(Type.TypeParams(...params), Type.Body(tnorm(fn(...params) as any)))
  }
  return Type.Type(name).pipe(Type.Body(tnorm(rest[0] as any)))
}

// ---------------------------------------------------------------------------
// operators — the full type-level vocabulary. every phantom is computed by
// TypeScript itself: eagerly on concrete inputs, symbolically (Op markers the
// substitution machinery reduces) when the inputs contain Variables.

/** keys like "0" denote a numeric literal index, not a prop literally named "0" */
const isIndexKey = (key: string): boolean => {
  const n = Number(key)
  return key !== "" && Number.isInteger(n) && n >= 0 && String(n) === key
}

/** an intersection from tnorm'd members: `$.inter(A, B)` */
export const inter = <const M extends [unknown, unknown, ...unknown[]]>(
  ...members: CheckEach<M>
): Type.Intersection<{ [K in keyof M]: Type.TypeExpr<TDenote<M[K]>> }> =>
  Type.Intersection(...(members as readonly unknown[]).map((member) => tnorm(member as any)) as any) as any

/** indexed access: `$.index(T, K)` — emits `T[K]`, phantom is real indexing (or a symbolic Op) */
export const index = <const O, const K>(
  object: O,
  key: K,
  ..._check: [...CheckType<O>, ...CheckType<K>]
): Type.IndexedAccess<Type.TypeExpr<TDenote<O>>, Type.TypeExpr<TDenote<K>>> => Type.Index(tnorm(object as any), tnorm(key as any)) as any

/** `$.keyof(T)` */
export const keyof = <const X>(operand: X, ..._check: CheckType<X>): Type.KeyOf<Type.TypeExpr<TDenote<X>>> => Type.KeyOf(tnorm(operand as any)) as any

/** a conditional type: `$.cond(check, pattern, then, else)` — no infer in v1; use the extractors below */
export const cond = <const C, const P, const T, const E>(
  check: C,
  pattern: P,
  then: T,
  else_: E,
  ..._check: [...CheckType<C>, ...CheckType<P>, ...CheckType<T>, ...CheckType<E>]
): Type.Conditional<Type.TypeExpr<TDenote<C>>, Type.TypeExpr<TDenote<P>>, Type.TypeExpr<TDenote<T>>, Type.TypeExpr<TDenote<E>>> =>
  Type.Conditional(tnorm(check as any), tnorm(pattern as any), tnorm(then as any), tnorm(else_ as any)) as any

/** a mapped type: `$.mapped(T, (K) => ...)` — the key name comes from the arrow, or pass it explicitly */
export function mapped<const S, const F>(
  source: S,
  fn: (key: Type.Param<string, any>) => F,
): Type.Mapped<string, Type.TypeExpr<TDenote<S>>, Type.TypeExpr<TDenote<F>>>
export function mapped<const K extends string, const S, const F>(
  key: K,
  source: S,
  fn: (key: Type.Param<K, any>) => F,
): Type.Mapped<K, Type.TypeExpr<TDenote<S>>, Type.TypeExpr<TDenote<F>>>
export function mapped(...args: [unknown, any] | [string, unknown, any]): Type.Mapped<string, any, any> {
  const [key, source, fn] = (typeof args[0] === "string" ? args : [callsiteParamNames(mapped)[0]!, ...args]) as [string, unknown, any]
  return Type.Mapped(key, tnorm(source as any), tnorm(fn(Type.Param(key)) as any))
}

/** template literal types: `` $.tmpl`prefix-${T}` ``, or `$.tmpl(["prefix-", ""], T)` when you need a literal phantom */
export function tmpl<const Parts extends readonly string[], const Exprs extends unknown[]>(
  parts: Parts,
  ...exprs: CheckEach<Exprs>
): Type.TemplateLiteralType<Parts, { [K in keyof Exprs]: Type.TypeExpr<TDenote<Exprs[K]>> }>
export function tmpl<const Exprs extends unknown[]>(
  parts: TemplateStringsArray,
  ...exprs: CheckEach<Exprs>
): Type.TemplateLiteralType<readonly string[], { [K in keyof Exprs]: Type.TypeExpr<TDenote<Exprs[K]>> }>
export function tmpl(parts: readonly string[], ...exprs: unknown[]): Type.TemplateLiteralType<readonly string[], any> {
  return Type.TemplateLiteral([...parts], ...exprs.map((e) => tnorm(e as any))) as any
}

/** `$.arrayOf(E)` — emits `E[]` */
export const arrayOf = <const E>(element: E, ..._check: CheckType<E>): Type.ArrayType<Type.TypeExpr<TDenote<E>>> =>
  Type.Array(tnorm(element as any)) as Type.ArrayType<Type.TypeExpr<TDenote<E>>>

/** function types from tnorm'd params and return: `$.fnType([$.T.string], $.T.number)` */
export const fnType = <const P extends unknown[], const R>(
  params: CheckEach<P>,
  returnType: R,
  ..._check: CheckType<R>
): Type.FunctionType<{ [K in keyof P]: Type.TypeExpr<TDenote<P[K]>> }, Type.TypeExpr<TDenote<R>>> =>
  Type.Function((params as readonly unknown[]).map((p) => tnorm(p as any)) as any, tnorm(returnType as any)) as any

// ---------------------------------------------------------------------------
// extractors — the standard infer patterns, as macros that expand to a real
// conditional node. the phantoms are hand-written real conditionals, so they
// are exact on both concrete and generic inputs.

/** `T extends readonly (infer E)[] ? E : never` */
export const elementOf = <const X>(x: X, ..._check: CheckType<X>): Type.TypeExpr<TDenote<X> extends readonly (infer E)[] ? E : never> =>
  Type.Conditional(tnorm(x as any), Type.Array(Type.InferVar("E")), Type.Param("E"), Primitive.Never()) as any

/** `T extends Promise<infer A> ? A : never` */
export const awaitedOf = <const X>(x: X, ..._check: CheckType<X>): Type.TypeExpr<TDenote<X> extends Promise<infer A> ? A : never> =>
  Type.Conditional(tnorm(x as any), Type.Ref("Promise", Type.InferVar("A")), Type.Param("A"), Primitive.Never()) as any

/** `T extends (...args: never[]) => infer R ? R : never` */
export const returnOf = <const X>(x: X, ..._check: CheckType<X>): Type.TypeExpr<TDenote<X> extends (...args: never[]) => infer R ? R : never> =>
  Type.Conditional(tnorm(x as any), Type.Function([], Type.InferVar("R"), Type.Array(Primitive.Never())), Type.Param("R"), Primitive.Never()) as any

/** `T extends (...args: infer P) => any ? P : never` */
export const parametersOf = <const X>(x: X, ..._check: CheckType<X>): Type.TypeExpr<TDenote<X> extends (...args: infer P) => any ? P : never> =>
  Type.Conditional(tnorm(x as any), Type.Function([], Primitive.Any(), Type.InferVar("P")), Type.Param("P"), Primitive.Never()) as any

// ---------------------------------------------------------------------------
// texpr — the type-level proxy surface. a closed trap: `.foo` is indexed
// access with a literal key, `Ref(...)` is type application. nothing else.

type TCall<A> = A extends Type.Fn<infer P, infer B>
  ? <const Args extends unknown[]>(...args: CheckEach<Args>) => TSurface<Substitute<B, P, { -readonly [K in keyof Args]: TDenote<Args[K]> }>>
  : unknown

// broad or abstract A: any-valued members, still callable — any absorbs the
// noUncheckedIndexedAccess undefined, so calls keep working
type TDynamic<A> = TBase<A> & { [key: string]: any } & ((...args: any[]) => any)

export type TSurface<A> =
    [unknown] extends [A] ? TDynamic<A>
  : Abstract<A> extends true ? TDynamic<A>
  : A extends string | number | boolean | bigint | symbol | null | undefined ? TBase<A>
  : A extends (...args: any) => any ? TBase<A> & TCall<A>
  : TBase<A> & { [K in keyof A]: TSurface<A[K & keyof A]> } & TCall<A>

/** wraps a TypeExpr node so `.prop` and `Ref(...)` read like type syntax, desugaring into Index/Apply nodes */
export const texpr = <const E extends Type.TypeExpr<any>>(node: E): TSurface<Type.Denotes<E>> => {
  const target = Object.assign(() => {}, { [NODE]: node })
  return new Proxy(target, {
    get(_target, key) {
      if (key === NODE) return node
      if (typeof key !== "string") return undefined
      const indexKey = isIndexKey(key) ? Type.Literal(Number(key)) : Type.Literal(key)
      return texpr(Type.Index(node, indexKey))
    },
    apply(_target, _thisArg, args) {
      return texpr(Type.Apply(node, args.map((arg) => tnorm(arg))))
    },
  }) as unknown as TSurface<Type.Denotes<E>>
}

/** the plain TypeExpr node a type surface wraps */
export const tderef = <A>(x: TSurface<A>): Type.TypeExpr<A> => (x as any)[NODE]
