import * as Expr from "./expr.ts"
import * as Fn from "./function.ts"
import { NODE, norm, type Surface } from "./norm.ts"

/** keys like "0" or "12" denote index access, not a prop literally named "0" */
const isIndexKey = (key: string): boolean => {
  const n = Number(key)
  return key !== "" && Number.isInteger(n) && n >= 0 && String(n) === key
}

/**
 * wraps an Expr node so `.prop` and `call(...)` read like the language being
 * emitted, desugaring into the same Prop/Call nodes the core constructors make.
 *
 * the get trap stays closed: every key becomes a Prop (or Index) node — real JS
 * never leaks into the tree. there is no `pipe` carve-out: `surface.pipe(f)`
 * builds Call(Prop(node, "pipe"), norm(f)) and norm throws on the function.
 */
export const expr = <const E extends Expr.Expr<any>>(node: E): Surface<Expr.Denotes<E>> => {
  // the proxy target is a function so the apply trap can fire for calls
  const target = Object.assign(() => {}, { [NODE]: node })
  return new Proxy(target, {
    get(_target, key) {
      if (key === NODE) return node
      if (typeof key !== "string") return undefined
      if (isIndexKey(key)) return expr(Expr.Index(node as Expr.Expr<readonly unknown[]>, Expr.Number(Number(key))))
      return expr(Expr.Prop(node as Expr.Expr<any>, key))
    },
    apply(_target, _thisArg, args) {
      return expr(Fn.Call(node as Expr.Expr<(...args: any[]) => any>, ...args.map((arg) => norm(arg))))
    },
  }) as unknown as Surface<Expr.Denotes<E>>
}
