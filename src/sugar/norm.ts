import * as Expr from "../expr.ts"
import { isAstNode } from "../pipeable.ts"
import type { Generic, Variable } from "../types/core.ts"

export const NODE: unique symbol = Symbol.for("ts-macros.surface-node") as any

declare const SurfaceId: unique symbol

export interface Base<A> {
  readonly [SurfaceId]?: A
}

export type Lift = string | number | boolean

/** what may stand for a value of type `A`: a node, a surface, or a plain value that lifts to one */
export type In<A> = Expr.Expr<A> | Surface<A> | Liftable<A>

type LiftableOne<A> =
    [A] extends [Lift] ? Extract<A, Lift>
  : [A] extends [(...a: any[]) => any] ? never
  : [A] extends [readonly (infer E)[]] ? readonly In<E>[]
  : [A] extends [object] ? { [K in keyof A]: In<A[K]> }
  : never

// distribute so string | Buffer still lifts strings
export type Liftable<A> = A extends any ? LiftableOne<A> : never

export type SurfaceMembers<A> =
    A extends (...args: infer P) => infer R ? (...args: { [K in keyof P]: In<P[K]> }) => Surface<R>
  : A extends object ? { [K in keyof A]: Surface<A[K]> }
  : unknown

// any, not an index signature: noUncheckedIndexedAccess would kill calls
export type Surface<A> = [unknown] extends [A] ? any : Base<A> & SurfaceMembers<A>

export type Denote<T> = T extends Expr.Expr<infer A> ? A
  // not Surface: `T extends Surface<infer A>` matches everything
  : T extends Base<infer A> ? A
  : T extends Variable<any> ? T
  : T extends Generic<any, any> ? T
  : T extends (...args: any[]) => any ? T
  // lifted arrays become Expr.Array nodes, which widen their elements
  : T extends readonly (infer E)[] ? Expr.Widen<Denote<E>>[]
  : T extends object ? { -readonly [K in keyof T]: Denote<T[K]> }
  : T

export type CheckLift<T> = [T] extends [In<Denote<T>>] ? [] : ["cannot lift", T]

// {__proto__: x} in a field literal swaps the prototype instead of naming a
// field — JS drops the key before Object.entries ever sees it. Reject the
// swap loudly instead of silently emitting an object missing a field.
export const plainFields = <F extends object>(fields: F): F => {
  if (Object.getPrototypeOf(fields) !== Object.prototype) {
    throw new Error(
      `fields must be a plain object literal — a "__proto__" key swaps the prototype and silently drops the field; rename it`,
    )
  }
  return fields
}

/** lifts a plain value to a node; nodes and surfaces pass through */
export const norm = <const X>(x: X, ..._check: CheckLift<X>): Expr.Expr<Denote<X>> => {
  const stashed = (x as any)?.[NODE]
  if (stashed !== undefined) return stashed
  if (isAstNode(x)) return x as Expr.Expr<Denote<X>>
  if (typeof x === "string") return Expr.String(x) as Expr.Expr<Denote<X>>
  if (typeof x === "number") return Expr.Number(x) as Expr.Expr<Denote<X>>
  if (typeof x === "boolean") return Expr.Boolean(x) as Expr.Expr<Denote<X>>
  if (Array.isArray(x)) return Expr.Array(...x.map((v) => norm(v))) as unknown as Expr.Expr<Denote<X>>
  if (x !== null && typeof x === "object") {
    // Object.entries has already lost a swapped prototype's key by the time
    // Expr.Object could check; guard the user's object itself
    return Expr.Object(
      Object.fromEntries(Object.entries(plainFields(x)).map(([key, value]) => [key, norm(value)])),
    ) as unknown as Expr.Expr<Denote<X>>
  }
  throw new Error(`cannot lift ${x === null ? "null" : typeof x}`)
}

export const deref = <A>(x: Surface<A>): Expr.Expr<A> => (x as any)[NODE]
