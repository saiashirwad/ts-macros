import * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import { NODE, norm, type Surface } from "../norm.ts"
import { makePipeable, NodeBrand, Prototype, stagingError } from "../pipeable.ts"

const call = (callee: Expr.Expr<any>, args: unknown[]): Expr.Expr<any> =>
  makePipeable({ tag: "call-expr", callee, args: args.map((arg) => norm(arg)) })

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
      if (key === Symbol.toPrimitive || key === "toString" || key === "valueOf") return () => stagingError(node)
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
        ? expr(Expr.Index(node as Expr.Expr<readonly unknown[]>, Expr.Number(Number(key))))
        : expr(Expr.Prop(node as Expr.Expr<any>, key)),
    (args) => expr(call(node, args)),
  ) as unknown as Surface<Expr.Denotes<E>>

export const callableRef = <Params extends Fn.AnyParams, Return>(name: string): Fn.DeclaredRef<Params, Return> => {
  const callable: any = (...args: any[]) => expr(call(callable, args))
  // Function.name is read-only; override it
  Object.defineProperty(callable, "name", { value: name, configurable: true, writable: true })
  return Object.assign(callable, {
    tag: "var-ref",
    [NodeBrand]: true,
    pipe: Prototype.pipe,
  }) as Fn.DeclaredRef<Params, Return>
}
