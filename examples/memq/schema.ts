import { Type } from "../../src/index.ts"

export interface Column<T> {
  readonly table: string
  readonly key: string
  readonly type: Type.Type<T>
}

type ColumnFactory<T> = (key: string, table: string) => Column<T>

const column = <T>(type: Type.Type<T>): ColumnFactory<T> => (key, table) => ({ table, key, type })

export const number = (): ColumnFactory<number> => column(Type.number)
export const text = (): ColumnFactory<string> => column(Type.string)
export const boolean = (): ColumnFactory<boolean> => column(Type.boolean)
export const enumOf = <const V extends string>(first: V, ...rest: V[]): ColumnFactory<V> =>
  column<V>(rest.reduce<Type.Type<V>>((union, value) => Type.union(union, Type.literal(value)), Type.literal(first)))

type Factories = Record<string, ColumnFactory<any>>
export type Columns<F extends Factories> = { readonly [K in keyof F]: ReturnType<F[K]> }

export interface Table<F extends Factories = Factories> {
  readonly name: string
  readonly columns: Columns<F>
}

export const table = <const F extends Factories>(name: string, factories: F): Table<F> => {
  const entries = Object.entries(factories).map(([key, factory]) => [key, factory(key, name)])
  // SAFETY: `entries` maps every key of `factories` to the column its factory builds.
  return { name, columns: Object.fromEntries(entries) as Columns<F> }
}
export type InferRow<T extends Table> = {
  [K in keyof T["columns"]]: T["columns"][K] extends Column<infer V> ? V : never
}
