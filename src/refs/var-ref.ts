import type { Expr } from "../foundation/expr.ts"

export interface VarRef<A = unknown> extends Expr<A> {
  readonly _tag: "var-ref"
  readonly name: string
}
