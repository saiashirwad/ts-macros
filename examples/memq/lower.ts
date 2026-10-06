import * as $ from "../../src/index.ts"
import { sameType } from "../../src/types/algebra.ts"
import type { Cond, Value } from "./ops.ts"
import { type QueryPlan, validateColumns } from "./plan.ts"
import type { Scalar, Table } from "./schema.ts"

type Row = Record<string, Scalar>
const comparisons = { "===": $.eq, "!==": $.neq, ">": $.gt, ">=": $.gte, "<": $.lt, "<=": $.lte }

const placeholderTypes = (cond: Cond | null, into: Record<string, $.Type<Scalar>> = {}): Record<string, $.Type<Scalar>> => {
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

const value = <T extends Scalar>(v: Value<T>, params: $.Expr<unknown>, type: $.Type<T>): T | $.Expr<T> =>
  v.k === "lit" ? v.v : $.checkedProp(params, v.name, type)

const condition = (row: $.Expr<unknown>, c: Cond, params: $.Expr<unknown>): $.In<boolean> => {
  switch (c.k) {
    case "cmp":
      switch (c.kind) {
        case "number":
          return comparisons[c.op]($.checkedProp(row, c.col.key, c.col.type), value(c.value, params, c.col.type))
        case "string":
          return comparisons[c.op]($.checkedProp(row, c.col.key, c.col.type), value(c.value, params, c.col.type))
        case "boolean":
          return comparisons[c.op]($.checkedProp(row, c.col.key, c.col.type), value(c.value, params, c.col.type))
      }
    case "and":
      return c.items.reduce<$.In<boolean>>((a, item) => $.and(a, condition(row, item, params)), true)
    case "or":
      return c.items.reduce<$.In<boolean>>((a, item) => $.or(a, condition(row, item, params)), false)
    case "not":
      return $.not(condition(row, c.item, params))
    case "in":
      switch (c.kind) {
        case "number":
          return c.values.reduce<$.In<boolean>>((a, v) => $.or(a, $.eq($.checkedProp(row, c.col.key, c.col.type), v)), false)
        case "string":
          return c.values.reduce<$.In<boolean>>((a, v) => $.or(a, $.eq($.checkedProp(row, c.col.key, c.col.type), v)), false)
      }
  }
}

export const lower = (plan: QueryPlan, table: Table) => {
  validateColumns(plan, table)
  const Row = $.Object(Object.fromEntries(Object.entries(table.columns).map(([key, column]): [string, $.Type<Scalar>] => [key, column.type])))
  const Params = $.Object(placeholderTypes(plan.where))
  const select = plan.select
  const Output = select
    ? $.Object(Object.fromEntries(Object.entries(select).map(([key, column]): [string, $.Type<Scalar>] => [key, column.type])))
    : Row
  const project = (row: $.Expr<Row>): $.Expr<Row> =>
    select
      ? $.object(
        Object.fromEntries(
          Object.entries(select).map(([out, column]): [string, $.Expr<Scalar>] => [out, $.checkedProp<Scalar>(row, column.key, column.type)]),
        ),
      )
      : row
  const push = (array: $.Expr<Row[]>, item: $.Expr<Row>) => $.do($.call($.prop(array, "push"), item))

  return $.build(function*() {
    return yield* $.fn("query", {
      params: [$.param("rows", $.Array(Row)), $.param("params", Params)],
      body: function*({ rows, params }) {
        if (plan.orderBy.length === 0 || plan.limit === 0) {
          const out = yield* $.const("out", $.array(), $.Array(Output))
          if (plan.limit === 0) return out
          const skipped = plan.offset > 0 ? yield* $.let("skipped", 0) : null
          yield* $.forOf("row", rows, function*(row) {
            if (plan.where) {
              yield* $.if($.not(condition(row, plan.where, params)), function*() {
                yield* $.continue()
              })
            }
            if (skipped) {
              yield* $.if($.lt(skipped, plan.offset), function*() {
                yield* $.assign(skipped, $.add(skipped, 1))
                yield* $.continue()
              })
            }
            yield* push(out, project(row))
            if (plan.limit !== null) {
              yield* $.if($.gte($.prop(out, "length"), plan.limit), function*() {
                yield* $.break()
              })
            }
          })
          return out
        }

        const matched = yield* $.const("matched", $.array(), $.Array(Row))
        yield* $.forOf("row", rows, function*(row) {
          if (plan.where) {
            yield* $.if(condition(row, plan.where, params), function*() {
              yield* push(matched, row)
            })
          } else {
            yield* push(matched, row)
          }
        })
        const comparator = $.arrow({
          params: [$.param("a", Row), $.param("b", Row)],
          body: function*({ a, b }) {
            return plan.orderBy.reduceRight<$.In<number>>((rest, order) => {
              const [before, after] = order.dir === "asc" ? [-1, 1] : [1, -1]
              switch (order.col.kind) {
                case "number": {
                  const x = $.checkedProp(a, order.col.key, order.col.type)
                  const y = $.checkedProp(b, order.col.key, order.col.type)
                  return $.cond($.lt(x, y), before, $.cond($.gt(x, y), after, rest))
                }
                case "string": {
                  const x = $.checkedProp(a, order.col.key, order.col.type)
                  const y = $.checkedProp(b, order.col.key, order.col.type)
                  return $.cond($.lt(x, y), before, $.cond($.gt(x, y), after, rest))
                }
                case "boolean": {
                  const x = $.checkedProp(a, order.col.key, order.col.type)
                  const y = $.checkedProp(b, order.col.key, order.col.type)
                  return $.cond($.neq(x, y), $.cond(x, after, before), rest)
                }
              }
            }, 0)
          },
        })
        yield* $.do($.call($.prop(matched, "sort"), comparator))
        const end = plan.limit === null ? $.prop(matched, "length") : plan.offset + plan.limit
        const page = yield* $.const("page", $.call($.prop(matched, "slice"), plan.offset, end), $.Array(Row))
        if (!select) return page
        const result = yield* $.const("result", $.array(), $.Array(Output))
        yield* $.forOf("row", page, function*(row) {
          yield* push(result, project(row))
        })
        return result
      },
    })
  })
}
