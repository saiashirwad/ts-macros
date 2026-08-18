import type * as Expr from "../expr.ts"
import { type Block, collectReturns } from "../statement.ts"
import type { TypeExpr } from "../types/core.ts"
import * as Type from "../types/index.ts"
import { lub, widen } from "../types/lattice.ts"

export const inferReturns = (
  body: Block,
  infer: (expr: Expr.Expr<any>) => TypeExpr<any> | undefined,
): TypeExpr<any> | undefined => {
  const returns = collectReturns(body)
  if (returns.length === 0) return Type.Void()

  const types = returns.map(infer)
  if (types.some((type) => type === undefined)) return undefined
  return lub(types.map((type) => widen(type!)))
}
