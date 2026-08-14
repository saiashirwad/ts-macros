import * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import { NODE, norm, type Surface } from "../norm.ts"
import { makePipeable, NodeBrand, Prototype } from "../pipeable.ts"

const call = (callee: Expr.Expr<any>, args: unknown[]): Expr.Expr<any> =>
  makePipeable({ tag: "call-expr", callee, args: args.map((arg) => norm(arg)) })

export const isIndexKey = (key: string): boolean => {
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
      return expr(call(node, args))
    },
  }) as unknown as Surface<Expr.Denotes<E>>
}

// a var-ref node that is also a callable surface: gains .prop and (...) sugar
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
