import type { TypeExpr } from "../foundation/type-expr"
import { makePipeable } from "../pipeable"

export interface TypeRef<A = unknown> extends TypeExpr<A> {
  readonly _tag: "type-ref"
  readonly name: string
}

export const makeTypeRef = <A = unknown>(name: string): TypeRef<A> =>
  makePipeable({
    _tag: "type-ref",
    name,
  }) as TypeRef<A>
