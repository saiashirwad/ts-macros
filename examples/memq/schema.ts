import { Type } from "../../src/index.ts"

export type Scalar = string | number | boolean

export interface Column<T extends Scalar = Scalar> {
  readonly table: string
  readonly key: string
  readonly type: Type.Type<T>
  readonly kind: "number" | "string" | "boolean"
}

export type NumericColumn = Column<number> & { readonly kind: "number" }
export type TextColumn<T extends string = string> = Column<T> & { readonly kind: "string" }
export type BooleanColumn = Column<boolean> & { readonly kind: "boolean" }
export type AnyColumn = NumericColumn | TextColumn | BooleanColumn

type ColumnFactory<C extends AnyColumn> = (key: string, table: string) => C

export const number = (): ColumnFactory<NumericColumn> => (key, table) => ({ kind: "number", table, key, type: Type.number })
export const text = (): ColumnFactory<TextColumn> => (key, table) => ({ kind: "string", table, key, type: Type.string })
export const boolean = (): ColumnFactory<BooleanColumn> => (key, table) => ({ kind: "boolean", table, key, type: Type.boolean })
export const enumOf = <const V extends string>(first: V, ...rest: V[]): ColumnFactory<TextColumn<V>> => {
  const type = rest.reduce<Type.Type<V>>((union, value) => Type.union(union, Type.literal(value)), Type.literal(first))
  return (key, table) => ({ kind: "string", table, key, type })
}

type Factories = Record<string, ColumnFactory<AnyColumn>>
export type Columns<F extends Factories> = { readonly [K in keyof F]: ReturnType<F[K]> }

export interface Table<F extends Factories = Factories> {
  readonly name: string
  readonly columns: Columns<F>
}

export const table = <const F extends Factories>(name: string, factories: F): Table<F> => {
  const entries = Object.entries(factories).map(([key, factory]): [string, AnyColumn] => [key, factory(key, name)])
  // SAFETY: every factory key is preserved and each value is the result of that key's factory.
  return { name, columns: Object.fromEntries(entries) as Columns<F> }
}
export type InferRow<T extends Table> = {
  [K in keyof T["columns"]]: T["columns"][K] extends Column<infer V> ? V : never
}
