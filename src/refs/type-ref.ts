import type { TypeExpr } from "../foundation/type-expr.ts"

export interface TypeRef<A = unknown> extends TypeExpr<A> {
  readonly tag: "type-ref"
  readonly name: string
}
