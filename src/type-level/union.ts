import type { TypeExpr } from "../foundation/type-expr.ts"
import { makePipeable } from "../pipeable.ts"

export type UnionMembers = readonly [TypeExpr<any>, TypeExpr<any>, ...(readonly TypeExpr<any>[])]

export type UnionTypeShape<Members extends readonly TypeExpr<any>[]> =
  Members[number] extends TypeExpr<infer A> ? A : never

export interface UnionType<Members extends UnionMembers = UnionMembers> extends TypeExpr<
  UnionTypeShape<Members>
> {
  readonly _tag: "union-type"
  readonly members: Members
}

export const union = <const Members extends UnionMembers>(
  ...members: Members
): UnionType<Members> =>
  makePipeable({
    _tag: "union-type",
    members,
  }) as UnionType<Members>
