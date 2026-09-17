import * as Expr from "../expr.ts"
import { isAstNode } from "../node.ts"

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

type NormEach<T extends readonly unknown[]> = { -readonly [K in keyof T]: Norm<T[K]> }

/**
 * The node a value lifts to. Keeping the node, rather than only what it
 * denotes, is what lets a declaration tell a fresh literal from a declared
 * one: `Sugar.Let("n", 1)` widens because `1` lifts to a `Literal`.
 */
export type Norm<T> = T extends Expr.Expr<any> ? T : T extends Lift ? Expr.Literal<T>
  // a function does not lift
: T extends (...args: any[]) => any ? never
: T extends readonly unknown[] ? Expr.ArrayExpr<Extract<NormEach<T>, Expr.Expr<any>[]>>
: T extends object ? Expr.ObjectExpr<{ readonly [K in keyof T]: Norm<T[K]> }>
: never

/** the type a value denotes once lifted; a function is kept whole, which is what lets `CheckLift` reject it */
export type Denotes<T> = T extends (...args: any[]) => any ? T : Expr.Denotes<Norm<T>>

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
export const norm = <const X>(x: X, ..._check: CheckLift<X>): Norm<X> => {
  if (isAstNode(x)) return x as unknown as Norm<X>
  if (typeof x === "string") return Expr.String(x) as unknown as Norm<X>
  if (typeof x === "number") return Expr.Number(x) as unknown as Norm<X>
  if (typeof x === "boolean") return Expr.Boolean(x) as unknown as Norm<X>
  if (Array.isArray(x)) return Expr.Array(...x.map((v) => norm(v))) as unknown as Norm<X>
  if (x !== null && typeof x === "object") {
    return Expr.Object(Object.fromEntries(Object.entries(plainFields(x)).map(([key, value]) => [key, norm(value)]))) as unknown as Norm<X>
  }
  throw new Error(`cannot lift ${x === null ? "null" : typeof x}`)
}
