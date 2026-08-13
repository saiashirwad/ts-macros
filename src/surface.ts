import * as Expr from "./expr.ts"
import * as Fn from "./function.ts"
import { NODE, norm, type Surface } from "./norm.ts"

const isIndexKey = (key: string): boolean => {
  const n = Number(key)
  return key !== "" && Number.isInteger(n) && n >= 0 && String(n) === key
}

export const expr = <const E extends Expr.Expr<any>>(node: E): Surface<Expr.Denotes<E>> => {
  // function target so apply fires
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
