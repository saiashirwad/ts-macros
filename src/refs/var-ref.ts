import type { Expr } from "../foundation/expr"
import { makePipeable } from "../pipeable"

export interface VarRef<A = unknown> extends Expr<A> {
  readonly _tag: "var-ref"
  readonly name: string
}

export const makeVarRef = <A = unknown>(name: string): VarRef<A> =>
  makePipeable({
    _tag: "var-ref",
    name,
  }) as VarRef<A>
