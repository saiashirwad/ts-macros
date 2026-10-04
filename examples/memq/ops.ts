import type { Column } from "./schema.ts"

export type Literal = string | number | boolean
export type Value = { readonly k: "lit"; readonly v: Literal } | { readonly k: "ph"; readonly name: string }
export type Comparison = "===" | "!==" | ">" | ">=" | "<" | "<="

export type Cond =
  | { readonly k: "cmp"; readonly op: Comparison; readonly col: string; readonly value: Value }
  | { readonly k: "and" | "or"; readonly items: readonly Cond[] }
  | { readonly k: "not"; readonly item: Cond }
  | { readonly k: "in"; readonly col: string; readonly values: readonly (string | number)[] }

export interface Placeholder<T> {
  readonly name: string
  readonly phantom?: T
}
export const placeholder = <T>(name: string): Placeholder<T> => ({ name })

const isPlaceholder = <T>(value: T | Placeholder<T>): value is Placeholder<T> => typeof value === "object" && value !== null && "name" in value

const toValue = <T extends Literal>(value: T | Placeholder<T>): Value => isPlaceholder(value) ? { k: "ph", name: value.name } : { k: "lit", v: value }

const comparison = (op: Comparison) => <T extends Literal>(column: Column<T>, value: NoInfer<T> | Placeholder<NoInfer<T>>): Cond => ({
  k: "cmp",
  op,
  col: column.key,
  value: toValue(value),
})

export const eq = comparison("===")
export const ne = comparison("!==")
export const gt = comparison(">")
export const gte = comparison(">=")
export const lt = comparison("<")
export const lte = comparison("<=")
export const inArray = <T extends string | number>(column: Column<T>, values: readonly NoInfer<T>[]): Cond => ({
  k: "in",
  col: column.key,
  values,
})
export const and = (...items: Cond[]): Cond => ({ k: "and", items })
export const or = (...items: Cond[]): Cond => ({ k: "or", items })
export const not = (item: Cond): Cond => ({ k: "not", item })

export interface Order {
  readonly col: string
  readonly dir: "asc" | "desc"
}
export const asc = (column: Column<Literal>): Order => ({ col: column.key, dir: "asc" })
export const desc = (column: Column<Literal>): Order => ({ col: column.key, dir: "desc" })
