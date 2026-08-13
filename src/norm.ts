import * as Expr from "./expr.ts"
import { NodeBrand } from "./pipeable.ts"
import type { Generic, Variable } from "./types/core.ts"

/** stashes the real node on a surface's proxy target, so the traps never shadow the compiler's view of the tree */
export const NODE: unique symbol = Symbol("ts-macros/surface-node")

declare const SurfaceId: unique symbol

/** phantom carrier for the denoted type, so deref is lossless */
interface Base<A> {
  readonly [SurfaceId]?: A
}

export type Lift = string | number | boolean

/** anything that normalizes to Expr<A>: a node, a surface, or a raw literal of A's shape */
export type In<A> = Expr.Expr<A> | Surface<A> | Liftable<A>

type LiftableOne<A> =
    [A] extends [Lift] ? Extract<A, Lift>
  : [A] extends [(...a: any[]) => any] ? never
  : [A] extends [readonly (infer E)[]] ? readonly In<E>[]
  : [A] extends [object] ? { [K in keyof A]: In<A[K]> }
  : never

// distribute over unions, so each member keeps its liftable fragment (string | Buffer lifts strings)
export type Liftable<A> = A extends any ? LiftableOne<A> : never

export type Shape<A> =
    A extends (...args: infer P) => infer R ? (...args: { [K in keyof P]: In<P[K]> }) => Surface<R>
  : A extends object ? { [K in keyof A]: Surface<A[K]> }
  : unknown

// broad A (untyped FFI) is just any — an index-signature shape would make every
// prop access `| undefined` under noUncheckedIndexedAccess, killing callability
export type Surface<A> = [unknown] extends [A] ? any : Base<A> & Shape<A>

/**
 * norm's type-level half: the denoted type of anything norm accepts. nodes and
 * surfaces unwrap to their phantom; raw shapes recurse. inference always flows
 * this way (infer the input X, compute Denote<X>) — inferring `A` backwards
 * through `In<A>` lets a node field masquerade as a liftable plain object and
 * the structural candidate beats the phantom one.
 */
export type Denote<T> = T extends Expr.Expr<infer A> ? A
  // match Base, not Surface: `T extends Surface<infer A>` is a deferred
  // conditional that matches everything; the phantom interface rejects cleanly
  : T extends Base<infer A> ? A
  : T extends Variable<any> ? T
  : T extends Generic<any, any> ? T
  : T extends (...args: any[]) => any ? T
  : T extends readonly unknown[] ? { -readonly [K in keyof T]: Denote<T[K]> }
  : T extends object ? { -readonly [K in keyof T]: Denote<T[K]> }
  : T

/** liftability as a rest-param check (the codebase's `_check` idiom): infers nothing, only validates */
export type CheckLift<T> = [T] extends [In<Denote<T>>] ? [] : ["cannot lift", T]

/**
 * the value normalizer: raw primitives, arrays, plain objects, Expr nodes, and
 * surfaces all become core Expr nodes. `norm(2)` replaces `Expr.Number(2)`.
 */
export const norm = <const X>(x: X, ..._check: CheckLift<X>): Expr.Expr<Denote<X>> => {
  const stashed = (x as any)?.[NODE]
  if (stashed !== undefined) return stashed
  if ((x as any)?.[NodeBrand] !== undefined) return x as Expr.Expr<Denote<X>>
  if (typeof x === "string") return Expr.String(x) as Expr.Expr<Denote<X>>
  if (typeof x === "number") return Expr.Number(x) as Expr.Expr<Denote<X>>
  if (typeof x === "boolean") return Expr.Boolean(x) as Expr.Expr<Denote<X>>
  if (Array.isArray(x)) return Expr.Array(...x.map((v) => norm(v))) as unknown as Expr.Expr<Denote<X>>
  if (x !== null && typeof x === "object") {
    return Expr.Object(Object.fromEntries(Object.entries(x).map(([key, value]) => [key, norm(value)]))) as unknown as Expr.Expr<Denote<X>>
  }
  throw new Error(`cannot lift ${x === null ? "null" : typeof x}`)
}

/** the plain tagged node a surface wraps — the closed AST the emitter already knows how to walk */
export const deref = <A>(x: Surface<A>): Expr.Expr<A> => (x as any)[NODE]
