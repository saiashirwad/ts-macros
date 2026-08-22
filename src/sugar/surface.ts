import * as Expr from "../expr.ts"
import * as Fn from "../function.ts"
import { NODE, norm, type Surface } from "./norm.ts"

export const stagingError = (node: unknown): never => {
  const tag = (node as { tag?: string } | null)?.tag ?? "node"
  throw new Error(
    `staging error: a ${tag} node escaped into a JavaScript operator (>, +, *, string interpolation, await, ...). `
      + "JS operators run at metaprogram time and cannot build nodes — use the sugar functions (add, sub, gt, ...) or $.expr for props/calls",
  )
}

export const isIndexKey = (key: string): boolean => {
  const n = Number(key)
  return key !== "" && Number.isInteger(n) && n >= 0 && String(n) === key
}

// the surface-proxy shape, shared with the type sugar: a function target (so
// apply fires) that stashes its node under NODE and forwards every prop read
// and call to the two handlers. String/number coercion is a staging error —
// without this trap a surface dies with bun's useless "No default value"
export const proxied = <T extends object>(
  node: T,
  get: (key: string) => unknown,
  apply: (args: any[]) => unknown,
): T => {
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

export const expr = <const E extends Expr.Expr<any>>(node: E): Surface<Expr.Denotes<E>> =>
  proxied(
    node,
    (key) =>
      isIndexKey(key)
        ? expr(Expr.Index(node as unknown as Expr.Expr<readonly unknown[]>, Expr.Number(Number(key))))
        : expr(Expr.Prop(node as Expr.Expr<any>, key)),
    (args) => expr(Fn.Call(node, ...args.map((arg) => norm(arg)) as any)),
  ) as unknown as Surface<Expr.Denotes<E>>
