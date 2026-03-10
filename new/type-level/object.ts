import type { TypeExpr } from "../foundation/type-expr";
import { makePipeable } from "../pipeable";

export interface TypeFields {
  readonly [key: string]: TypeExpr<any>;
}

export type ObjectTypeShape<Fields extends TypeFields> = {
  readonly [K in keyof Fields]: Fields[K] extends TypeExpr<infer A> ? A : never;
};

export interface ObjectType<
  Fields extends TypeFields = TypeFields,
> extends TypeExpr<ObjectTypeShape<Fields>> {
  readonly _tag: "object-type";
  readonly fields: Fields;
}

export const object = <const Fields extends TypeFields>(
  fields: Fields,
): ObjectType<Fields> =>
  makePipeable({
    _tag: "object-type",
    fields,
  }) as ObjectType<Fields>;
