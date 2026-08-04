import type { TypeExpr } from "../foundation/type-expr.ts"
import { makePipeable } from "../pipeable.ts"

export interface TypeFields {
  readonly [key: string]: TypeExpr<any>
}

export type ObjectTypeShape<Fields extends TypeFields> = {
  readonly [K in keyof Fields]: Fields[K] extends TypeExpr<infer A> ? A : never
}

export interface ObjectType<Fields extends TypeFields = TypeFields> extends TypeExpr<
  ObjectTypeShape<Fields>
> {
  readonly tag: "object-type"
  readonly fields: Fields
}

export const object = <const Fields extends TypeFields>(fields: Fields): ObjectType<Fields> =>
  makePipeable({
    tag: "object-type",
    fields,
  }) as ObjectType<Fields>
