import type { TypeExpr } from "../foundation/type-expr.ts"
import { makePipeable } from "../pipeable.ts"

export interface TypeRef<A = unknown> extends TypeExpr<A> {
  readonly _tag: "type-ref"
  readonly name: string
}

export const makeTypeRef = <A = unknown>(name: string): TypeRef<A> =>
  makePipeable({
    _tag: "type-ref",
    name,
  }) as TypeRef<A>
