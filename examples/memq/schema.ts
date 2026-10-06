import * as $ from "../../src/index.ts"

export type Scalar = string | number | boolean

export interface Column<T extends Scalar = Scalar> {
  readonly table: string
  readonly key: string
  readonly type: $.Type<T>
  readonly kind: "number" | "string" | "boolean"
}

export type NumericColumn = Column<number> & { readonly kind: "number" }
export type TextColumn<T extends string = string> = Column<T> & { readonly kind: "string" }
export type BooleanColumn = Column<boolean> & { readonly kind: "boolean" }
export type AnyColumn = NumericColumn | TextColumn | BooleanColumn

type ColumnFactory<C extends AnyColumn> = (key: string, table: string) => C

export const number = (): ColumnFactory<NumericColumn> => (key, table) => ({ kind: "number", table, key, type: $.Number })
export const text = (): ColumnFactory<TextColumn> => (key, table) => ({ kind: "string", table, key, type: $.String })
export const boolean = (): ColumnFactory<BooleanColumn> => (key, table) => ({ kind: "boolean", table, key, type: $.Boolean })
export const enumOf = <const V extends string>(first: V, ...rest: V[]): ColumnFactory<TextColumn<V>> => {
  const type = rest.reduce<$.Type<V>>((union, value) => $.Union(union, $.Literal(value)), $.Literal(first))
  return (key, table) => ({ kind: "string", table, key, type })
}

type Factories = Record<string, ColumnFactory<AnyColumn>>
export type Columns<F extends Factories> = { readonly [K in keyof F]: ReturnType<F[K]> }

export interface Table<F extends Factories = Factories> {
  readonly name: string
  readonly columns: Columns<F>
}

export function table<const F extends Factories>(name: string, factories: F & Record<Extract<keyof F, symbol>, never>): Table<F>
export function table(name: string, factories: Factories): Table {
  const prototype = Object.getPrototypeOf(factories)
  if (prototype !== null && prototype !== Object.prototype) throw new TypeError("table factories must be a plain object")
  if (Object.getOwnPropertySymbols(factories).length !== 0) throw new TypeError("table factories must use string keys")
  for (const key of Object.getOwnPropertyNames(factories)) {
    const descriptor = Object.getOwnPropertyDescriptor(factories, key)
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("table factories must be enumerable data properties")
  }
  const entries = Object.entries(factories).map(([key, factory]): [string, AnyColumn] => [key, factory(key, name)])
  return { name, columns: Object.fromEntries(entries) }
}
export type InferRow<T extends Table> = {
  [K in keyof T["columns"]]: T["columns"][K] extends Column<infer V> ? V : never
}
