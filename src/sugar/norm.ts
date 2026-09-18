import * as Expr from "../expr.ts"
import { isAstNode } from "../node.ts"

type Lift = string | number | boolean

/** what may stand for a value of type `A`: a node, or a plain value that lifts to one */
export type In<A> = Expr.Expr<A> | Liftable<A>

type StringKeyed<A> = Extract<keyof A, symbol> extends never ? A : never

type LiftableOne<A> =
    [A] extends [Lift] ? Extract<A, Lift>
  : [A] extends [(...a: any[]) => any] ? never
  : [A] extends [readonly (infer E)[]] ? readonly In<E>[]
  : [A] extends [object] ?
      StringKeyed<A> extends never ? never
    : { [K in keyof A]: In<A[K]> }
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
: T extends object ? StringKeyed<T> extends never ? never : Expr.ObjectExpr<{ readonly [K in keyof T]: Norm<T[K]> }>
: never

/** the type a value denotes once lifted; a function is kept whole, which is what lets `CheckLift` reject it */
export type Denotes<T> = T extends (...args: any[]) => any ? T : Expr.Denotes<Norm<T>>

export type CheckLift<T> = [T] extends [In<Denotes<T>>] ? [] : ["cannot lift", T]

/** validates that every own field can be represented by `Expr.Object` without reading it */
const plainFields = <F extends object>(fields: F) => {
  if (Object.getPrototypeOf(fields) !== Object.prototype) {
    throw new Error(`fields must be a plain object literal with Object.prototype`)
  }

  const descriptors = Object.getOwnPropertyDescriptors(fields)
  if (Reflect.ownKeys(descriptors).some((key) => typeof key === "symbol")) {
    throw new Error(`fields must not have symbol keys`)
  }

  const values: Record<string, unknown> = {}
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) throw new Error(`field "${key}" must be enumerable`)
    if (!("value" in descriptor)) throw new Error(`field "${key}" must be a data property, not an accessor`)
    values[key] = descriptor.value
  }
  return values
}

/** lifts a plain value to a node; a node passes through */
export const norm = <const X>(x: X, ..._check: CheckLift<X>): Norm<X> => {
  if (isAstNode(x)) return x as unknown as Norm<X>
  if (typeof x === "string") return Expr.String(x) as unknown as Norm<X>
  if (typeof x === "number") return Expr.Number(x) as unknown as Norm<X>
  if (typeof x === "boolean") return Expr.Boolean(x) as unknown as Norm<X>
  if (Array.isArray(x)) return Expr.Array(...x.map((v) => norm(v))) as unknown as Norm<X>
  if (x !== null && typeof x === "object") {
    return Expr.Object(Object.fromEntries(Object.entries(plainFields(x)).map(([key, value]) => [key, norm(value as any)]))) as unknown as Norm<X>
  }
  throw new Error(`cannot lift ${x === null ? "null" : typeof x}`)
}
