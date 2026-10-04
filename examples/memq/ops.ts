import type { AnyColumn, BooleanColumn, Column, NumericColumn, Scalar, TextColumn } from "./schema.ts"

export type Literal = Scalar
export type Value<T extends Scalar> = { readonly k: "lit"; readonly v: T } | { readonly k: "ph"; readonly name: string }
export type Equality = "===" | "!=="
export type Comparison = Equality | ">" | ">=" | "<" | "<="

type ComparisonNode<T extends Scalar, C extends Column<T>, K extends string, O extends Comparison> = {
  readonly k: "cmp"
  readonly kind: K
  readonly op: O
  readonly col: C
  readonly value: Value<T>
}

export type Cond =
  | ComparisonNode<number, NumericColumn, "number", Comparison>
  | ComparisonNode<string, TextColumn, "string", Comparison>
  | ComparisonNode<boolean, BooleanColumn, "boolean", Equality>
  | { readonly k: "and" | "or"; readonly items: readonly Cond[] }
  | { readonly k: "not"; readonly item: Cond }
  | { readonly k: "in"; readonly kind: "number"; readonly col: NumericColumn; readonly values: readonly number[] }
  | { readonly k: "in"; readonly kind: "string"; readonly col: TextColumn; readonly values: readonly string[] }

export interface Placeholder<T extends Scalar> {
  readonly name: string
  readonly phantom?: T
}
export const placeholder = <T extends Scalar>(name: string): Placeholder<T> => ({ name })

type ColumnValue<C extends AnyColumn> = C extends Column<infer T> ? T : never
const isPlaceholder = (value: Scalar | Placeholder<Scalar>): value is Placeholder<Scalar> => typeof value === "object"
const isNumber = (value: Scalar): value is number => typeof value === "number"
const isString = (value: Scalar): value is string => typeof value === "string"
const isBoolean = (value: Scalar): value is boolean => typeof value === "boolean"

const checkedValue = <T extends Scalar>(value: Scalar | Placeholder<Scalar>, matches: (value: Scalar) => value is T): Value<T> => {
  if (isPlaceholder(value)) return { k: "ph", name: value.name }
  if (!matches(value)) throw new TypeError("comparison value does not match its column")
  return { k: "lit", v: value }
}

const comparison = (op: Comparison, column: AnyColumn, value: Scalar | Placeholder<Scalar>): Cond => {
  switch (column.kind) {
    case "number":
      return { k: "cmp", kind: "number", op, col: column, value: checkedValue(value, isNumber) }
    case "string":
      return { k: "cmp", kind: "string", op, col: column, value: checkedValue(value, isString) }
    case "boolean":
      if (op !== "===" && op !== "!==") throw new TypeError("boolean columns do not support ordered comparisons")
      return { k: "cmp", kind: "boolean", op, col: column, value: checkedValue(value, isBoolean) }
  }
}

const equality = (op: Equality) => <C extends AnyColumn>(column: C, value: NoInfer<ColumnValue<C>> | Placeholder<NoInfer<ColumnValue<C>>>): Cond =>
  comparison(op, column, value)
const ordered = (op: Exclude<Comparison, Equality>) =>
<C extends NumericColumn | TextColumn>(
  column: C,
  value: NoInfer<ColumnValue<C>> | Placeholder<NoInfer<ColumnValue<C>>>,
): Cond => comparison(op, column, value)

export const eq = equality("===")
export const ne = equality("!==")
export const gt = ordered(">")
export const gte = ordered(">=")
export const lt = ordered("<")
export const lte = ordered("<=")
export const inArray = <C extends NumericColumn | TextColumn>(column: C, values: readonly NoInfer<ColumnValue<C>>[]): Cond => {
  if (column.kind === "number") {
    const numeric = values.map((value) => {
      if (!isNumber(value)) throw new TypeError("membership values do not match numeric column")
      return value
    })
    return { k: "in", kind: "number", col: column, values: numeric }
  }
  const strings = values.map((value) => {
    if (!isString(value)) throw new TypeError("membership values do not match text column")
    return value
  })
  return { k: "in", kind: "string", col: column, values: strings }
}
export const and = (...items: Cond[]): Cond => ({ k: "and", items })
export const or = (...items: Cond[]): Cond => ({ k: "or", items })
export const not = (item: Cond): Cond => ({ k: "not", item })

export interface Order {
  readonly col: AnyColumn
  readonly dir: "asc" | "desc"
}
export const asc = (column: AnyColumn): Order => ({ col: column, dir: "asc" })
export const desc = (column: AnyColumn): Order => ({ col: column, dir: "desc" })
