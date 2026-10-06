import * as T from "../../src/index.ts"
import { sameType } from "../../src/types/algebra.ts"
import type { Cond, Value } from "./ops.ts"
import { type QueryPlan, validateColumns } from "./plan.ts"
import type { Scalar, Table } from "./schema.ts"

type Row = Record<string, Scalar>
const comparisons = { "===": T.eq, "!==": T.neq, ">": T.gt, ">=": T.gte, "<": T.lt, "<=": T.lte }

const placeholderTypes = (cond: Cond | null, into: Record<string, T.Type<Scalar>> = {}): Record<string, T.Type<Scalar>> => {
  if (cond === null) return into
  switch (cond.k) {
    case "cmp":
      if (cond.value.k === "ph") {
        const name = cond.value.name
        const previous = Object.hasOwn(into, name) ? into[name] : undefined
        if (previous && !sameType(previous, cond.col.type)) throw new Error(`placeholder "${name}" has conflicting column types`)
        Object.defineProperty(into, name, { value: cond.col.type, enumerable: true, configurable: true })
      }
      break
    case "and":
    case "or":
      for (const item of cond.items) placeholderTypes(item, into)
      break
    case "not":
      placeholderTypes(cond.item, into)
      break
    case "in":
      break
  }
  return into
}

const value = <T extends Scalar>(v: Value<T>, params: T.Expr<unknown>, type: T.Type<T>): T | T.Expr<T> =>
  v.k === "lit" ? v.v : T.checkedProp(params, v.name, type)

const condition = (row: T.Expr<unknown>, c: Cond, params: T.Expr<unknown>): T.In<boolean> => {
  switch (c.k) {
    case "cmp":
      switch (c.kind) {
        case "number":
          return comparisons[c.op](T.checkedProp(row, c.col.key, c.col.type), value(c.value, params, c.col.type))
        case "string":
          return comparisons[c.op](T.checkedProp(row, c.col.key, c.col.type), value(c.value, params, c.col.type))
        case "boolean":
          return comparisons[c.op](T.checkedProp(row, c.col.key, c.col.type), value(c.value, params, c.col.type))
      }
    case "and":
      return c.items.reduce<T.In<boolean>>((a, item) => T.and(a, condition(row, item, params)), true)
    case "or":
      return c.items.reduce<T.In<boolean>>((a, item) => T.or(a, condition(row, item, params)), false)
    case "not":
      return T.not(condition(row, c.item, params))
    case "in":
      switch (c.kind) {
        case "number":
          return c.values.reduce<T.In<boolean>>((a, v) => T.or(a, T.eq(T.checkedProp(row, c.col.key, c.col.type), v)), false)
        case "string":
          return c.values.reduce<T.In<boolean>>((a, v) => T.or(a, T.eq(T.checkedProp(row, c.col.key, c.col.type), v)), false)
      }
  }
}

export const lower = (plan: QueryPlan, table: Table) => {
  validateColumns(plan, table)
  const Row = T.Object(Object.fromEntries(Object.entries(table.columns).map(([key, column]): [string, T.Type<Scalar>] => [key, column.type])))
  const Params = T.Object(placeholderTypes(plan.where))
  const select = plan.select
  const Output = select
    ? T.Object(Object.fromEntries(Object.entries(select).map(([key, column]): [string, T.Type<Scalar>] => [key, column.type])))
    : Row
  const project = (row: T.Expr<Row>): T.Expr<Row> =>
    select
      ? T.objectLiteral(
        Object.fromEntries(
          Object.entries(select).map(([out, column]): [string, T.Expr<Scalar>] => [out, T.checkedProp<Scalar>(row, column.key, column.type)]),
        ),
      )
      : row
  const push = (array: T.Expr<Row[]>, item: T.Expr<Row>) => T.do(T.call(T.prop(array, "push"), item))

  return T.build(function*() {
    return yield* T.fn("query", {
      params: [T.param("rows", T.Array(Row)), T.param("params", Params)],
      body: function*({ rows, params }) {
        if (plan.orderBy.length === 0 || plan.limit === 0) {
          const out = yield* T.const("out", T.arrayLiteral(), T.Array(Output))
          if (plan.limit === 0) return out
          const skipped = plan.offset > 0 ? yield* T.let("skipped", 0) : null
          yield* T.forOf("row", rows, function*(row) {
            if (plan.where) {
              yield* T.if(T.not(condition(row, plan.where, params)), function*() {
                yield* T.continue()
              })
            }
            if (skipped) {
              yield* T.if(T.lt(skipped, plan.offset), function*() {
                yield* T.assign(skipped, T.add(skipped, 1))
                yield* T.continue()
              })
            }
            yield* push(out, project(row))
            if (plan.limit !== null) {
              yield* T.if(T.gte(T.prop(out, "length"), plan.limit), function*() {
                yield* T.break()
              })
            }
          })
          return out
        }

        const matched = yield* T.const("matched", T.arrayLiteral(), T.Array(Row))
        yield* T.forOf("row", rows, function*(row) {
          if (plan.where) {
            yield* T.if(condition(row, plan.where, params), function*() {
              yield* push(matched, row)
            })
          } else {
            yield* push(matched, row)
          }
        })
        const comparator = T.arrow({
          params: [T.param("a", Row), T.param("b", Row)],
          body: function*({ a, b }) {
            return plan.orderBy.reduceRight<T.In<number>>((rest, order) => {
              const [before, after] = order.dir === "asc" ? [-1, 1] : [1, -1]
              switch (order.col.kind) {
                case "number": {
                  const x = T.checkedProp(a, order.col.key, order.col.type)
                  const y = T.checkedProp(b, order.col.key, order.col.type)
                  return T.cond(T.lt(x, y), before, T.cond(T.gt(x, y), after, rest))
                }
                case "string": {
                  const x = T.checkedProp(a, order.col.key, order.col.type)
                  const y = T.checkedProp(b, order.col.key, order.col.type)
                  return T.cond(T.lt(x, y), before, T.cond(T.gt(x, y), after, rest))
                }
                case "boolean": {
                  const x = T.checkedProp(a, order.col.key, order.col.type)
                  const y = T.checkedProp(b, order.col.key, order.col.type)
                  return T.cond(T.neq(x, y), T.cond(x, after, before), rest)
                }
              }
            }, 0)
          },
        })
        yield* T.do(T.call(T.prop(matched, "sort"), comparator))
        const end = plan.limit === null ? T.prop(matched, "length") : plan.offset + plan.limit
        const page = yield* T.const("page", T.call(T.prop(matched, "slice"), plan.offset, end), T.Array(Row))
        if (!select) return page
        const result = yield* T.const("result", T.arrayLiteral(), T.Array(Output))
        yield* T.forOf("row", page, function*(row) {
          yield* push(result, project(row))
        })
        return result
      },
    })
  })
}
