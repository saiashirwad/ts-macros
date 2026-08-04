import type { Expr } from "../foundation/expr.ts"

export interface VarRef<A = unknown> extends Expr<A> {
  readonly tag: "var-ref"
  readonly name: string
}
