import * as Expr from "../expr.ts"
import * as Fn from "../function.ts"
import { brandFunction } from "../node.ts"
import { NODE, norm, type Surface, type SurfaceMembers } from "./norm.ts"

/**
 * JavaScript operators run while the program is being built, so applied to a
 * surface they would quietly turn a node into "[object Object]". Every
 * coercion a surface can undergo throws this instead.
 */
const stagingError = (node: unknown): never => {
  const tag = (node as { tag?: string } | null)?.tag ?? "node"
  throw new Error(
    `staging error: a ${tag} node escaped into a JavaScript operator (>, +, *, string interpolation, await, ...). `
      + "JS operators run at metaprogram time and cannot build nodes — use the sugar functions (add, sub, gt, ...) or Sugar.expr for props/calls",
  )
}

const isIndexKey = (key: string): boolean => {
  const n = Number(key)
  return key !== "" && Number.isInteger(n) && n >= 0 && String(n) === key
}

/** a function target (so the `apply` trap fires) that keeps its node under `NODE` and hands every property read and call to the two handlers */
const proxied = <T extends object>(node: T, get: (key: string) => unknown, apply: (args: any[]) => unknown): T => {
  const target = Object.assign(() => {}, { [NODE]: node })
  return new Proxy(target, {
    get(_target, key) {
      if (key === NODE) return node
      if (key === Symbol.toPrimitive || key === "toString" || key === "valueOf" || key === "then") {
        return () => stagingError(node)
      }
      if (key === "pipe") {
        return (node as any).pipe.bind(node)
      }
      if (typeof key !== "string") return undefined
      return get(key)
    },
    apply(_target, _thisArg, args) {
      return apply(args)
    },
  }) as unknown as T
}

/** wraps a node so property reads build `Prop`/`Index` nodes and calls build `Call` nodes */
export const expr = <const E extends Expr.Expr<any>>(node: E): Surface<Expr.Denotes<E>> =>
  proxied(
    node,
    (key) =>
      isIndexKey(key)
        ? expr(Expr.Index(node as unknown as Expr.Expr<readonly unknown[]>, Expr.Number(Number(key))))
        : expr(Expr.Prop(node as Expr.Expr<any>, key)),
    (args) => expr(Fn.Call(node, ...args.map((arg) => norm(arg)) as any)),
  ) as unknown as Surface<Expr.Denotes<E>>

/** a node that is also a function: calling it builds a `Call` node whose result is a surface */
export type Callable<R extends Expr.Expr<any>> = R & SurfaceMembers<Expr.Denotes<R>>

export const callable = <R extends Expr.Expr<any> & { readonly nameHint: string }>(ref: R): Callable<R> => {
  const fn = (...args: any[]) => expr(Fn.Call(fn as unknown as R, ...args.map((arg) => norm(arg)) as any))
  Object.defineProperty(fn, "name", { value: ref.nameHint, configurable: true })
  return Object.assign(brandFunction(fn), ref) as unknown as Callable<R>
}
