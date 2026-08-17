import { makeTypeNode } from "../../pipeable.ts"
import type { TypeExpr } from "../core.ts"

type LiteralValue = string | number | boolean | null

export interface Literal<Value extends LiteralValue = LiteralValue> extends TypeExpr<Value> {
  readonly tag: "literal"
  readonly value: Value
}

export const Literal = <const Value extends LiteralValue>(value: Value): Literal<Value> => makeTypeNode({ tag: "literal", value })
