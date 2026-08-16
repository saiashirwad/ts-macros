import { makePipeable } from "../../pipeable.ts"
import type { ArgTypes, Denotes, TypeExpr } from "../core.ts"

interface Fields {
  [key: string]: TypeExpr<any>
}

export interface ReadonlyField<F extends TypeExpr<any> = TypeExpr<any>> extends TypeExpr<Denotes<F>> {
  readonly tag: "readonly-field"
  readonly field: F
}

export const Readonly = <const F extends TypeExpr<any>>(field: F): ReadonlyField<F> => makePipeable({ tag: "readonly-field", field })

type ObjectFields<F extends Fields> =
  & { readonly [K in keyof F as F[K] extends ReadonlyField<any> ? K : never]: Denotes<F[K]> }
  & { -readonly [K in keyof F as F[K] extends ReadonlyField<any> ? never : K]: Denotes<F[K]> }

export interface Object<F extends Fields = Fields> extends TypeExpr<ObjectFields<F>> {
  readonly tag: "object"
  readonly fields: F
}

type UnionMembers = [TypeExpr<any>, TypeExpr<any>, ...TypeExpr<any>[]]

type UnionValue<Members extends TypeExpr<any>[]> = Members[number] extends TypeExpr<infer A> ? A : never

export interface Union<Members extends UnionMembers> extends TypeExpr<UnionValue<Members>> {
  readonly tag: "union"
  readonly members: Members
}

export interface ArrayType<Element extends TypeExpr<any> = TypeExpr<any>> extends
  TypeExpr<
    Array<Denotes<Element>>
  >
{
  readonly tag: "array"
  readonly element: Element
}

export interface TupleType<Items extends TypeExpr<any>[] = TypeExpr<any>[]> extends
  TypeExpr<
    ArgTypes<Items>
  >
{
  readonly tag: "tuple"
  readonly items: Items
}

export interface FunctionType<
  Params extends TypeExpr<any>[] = TypeExpr<any>[],
  Return extends TypeExpr<any> = TypeExpr<any>,
> extends TypeExpr<(...args: ArgTypes<Params>) => Denotes<Return>> {
  readonly tag: "function"
  readonly params: Params
  readonly return: Return
}

export const Object = <const F extends Fields>(fields: F): Object<F> => makePipeable({ tag: "object", fields })

export const Union = <const Members extends UnionMembers>(...members: Members): Union<Members> => makePipeable({ tag: "union", members })

export const Array = <const Element extends TypeExpr<any>>(element: Element): ArrayType<Element> => makePipeable({ tag: "array", element })

export const Tuple = <const Items extends TypeExpr<any>[]>(...items: Items): TupleType<Items> => makePipeable({ tag: "tuple", items })

export const Function = <const Params extends TypeExpr<any>[], const Return extends TypeExpr<any>>(
  params: Params,
  returnType: Return,
): FunctionType<Params, Return> => makePipeable({ tag: "function", params, return: returnType })
