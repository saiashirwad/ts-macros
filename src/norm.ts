import * as Expr from "./expr.ts"
import { NodeBrand } from "./pipeable.ts"
import type { Generic, Variable } from "./types/core.ts"

export const NODE: unique symbol = Symbol("ts-macros/surface-node")

declare const SurfaceId: unique symbol

interface Base<A> {
  readonly [SurfaceId]?: A
}

export type Lift = string | number | boolean

export type In<A> = Expr.Expr<A> | Surface<A> | Liftable<A>

type LiftableOne<A> =
    [A] extends [Lift] ? Extract<A, Lift>
  : [A] extends [(...a: any[]) => any] ? never
  : [A] extends [readonly (infer E)[]] ? readonly In<E>[]
  : [A] extends [object] ? { [K in keyof A]: In<A[K]> }
  : never

// distribute so string | Buffer still lifts strings
export type Liftable<A> = A extends any ? LiftableOne<A> : never

export type Shape<A> =
    A extends (...args: infer P) => infer R ? (...args: { [K in keyof P]: In<P[K]> }) => Surface<R>
  : A extends object ? { [K in keyof A]: Surface<A[K]> }
  : unknown

// any, not an index signature: noUncheckedIndexedAccess would kill calls
export type Surface<A> = [unknown] extends [A] ? any : Base<A> & Shape<A>

export type Denote<T> = T extends Expr.Expr<infer A> ? A
  // not Surface: `T extends Surface<infer A>` matches everything
  : T extends Base<infer A> ? A
  : T extends Variable<any> ? T
  : T extends Generic<any, any> ? T
  : T extends (...args: any[]) => any ? T
  : T extends readonly unknown[] ? { -readonly [K in keyof T]: Denote<T[K]> }
  : T extends object ? { -readonly [K in keyof T]: Denote<T[K]> }
  : T

export type CheckLift<T> = [T] extends [In<Denote<T>>] ? [] : ["cannot lift", T]

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

export const deref = <A>(x: Surface<A>): Expr.Expr<A> => (x as any)[NODE]
