import * as Expr from "../expr.ts"
import { isAstNode } from "../node.ts"
import type { Widen } from "../types/lattice.ts"

type Lift = string | number | boolean

/** what may stand for a value of type `A`: a node, or a plain value that lifts to one */
export type In<A> = Expr.Expr<A> | Liftable<A>

type LiftableOne<A> =
    [A] extends [Lift] ? Extract<A, Lift>
  : [A] extends [(...a: any[]) => any] ? never
  : [A] extends [readonly (infer E)[]] ? readonly In<E>[]
  : [A] extends [object] ? { [K in keyof A]: In<A[K]> }
  : never

/** distributes over a union, so `string | Buffer` still lifts strings */
type Liftable<A> = A extends any ? LiftableOne<A> : never

/** the type a value denotes once lifted */
export type Denotes<T> = T extends Expr.Expr<infer A> ? A
  // a function does not lift; keeping it whole is what lets `CheckLift` reject it
  : T extends (...args: any[]) => any ? T
  // a lifted array becomes an `Expr.Array` node, which widens its elements
  : T extends readonly (infer E)[] ? Widen<Denotes<E>>[]
  : T extends object ? { -readonly [K in keyof T]: Denotes<T[K]> }
  : T

export type CheckLift<T> = [T] extends [In<Denotes<T>>] ? [] : ["cannot lift", T]

/**
 * `{ __proto__: x }` in an object literal swaps the prototype instead of
 * naming a field, and `Object.entries` never sees the key. Reject the swap
 * rather than emit an object that is silently missing a field.
 */
const plainFields = <F extends object>(fields: F): F => {
  if (Object.getPrototypeOf(fields) !== Object.prototype) {
    throw new Error(`fields must be a plain object literal — a "__proto__" key swaps the prototype and silently drops the field; rename it`)
  }
  return fields
}

/** lifts a plain value to a node; a node passes through */
export const norm = <const X>(x: X, ..._check: CheckLift<X>): Expr.Expr<Denotes<X>> => {
  if (isAstNode(x)) return x as Expr.Expr<Denotes<X>>
  if (typeof x === "string") return Expr.String(x) as Expr.Expr<Denotes<X>>
  if (typeof x === "number") return Expr.Number(x) as Expr.Expr<Denotes<X>>
  if (typeof x === "boolean") return Expr.Boolean(x) as Expr.Expr<Denotes<X>>
  if (Array.isArray(x)) return Expr.Array(...x.map((v) => norm(v))) as unknown as Expr.Expr<Denotes<X>>
  if (x !== null && typeof x === "object") {
    return Expr.Object(Object.fromEntries(Object.entries(plainFields(x)).map(([key, value]) => [key, norm(value)]))) as unknown as Expr.Expr<
      Denotes<X>
    >
  }
  throw new Error(`cannot lift ${x === null ? "null" : typeof x}`)
}
