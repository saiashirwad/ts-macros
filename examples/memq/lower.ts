import { Decl, Expr, Program, Stmt, Type } from "../../src/index.ts"
import { sameType } from "../../src/types/algebra.ts"
import type { Cond, Value } from "./ops.ts"
import { type QueryPlan, validateColumns } from "./plan.ts"
import type { Scalar, Table } from "./schema.ts"

type Row = Record<string, Scalar>
const comparisons = { "===": Expr.eq, "!==": Expr.neq, ">": Expr.gt, ">=": Expr.gte, "<": Expr.lt, "<=": Expr.lte }

const placeholderTypes = (cond: Cond | null, into: Record<string, Type.Type<Scalar>> = {}): Record<string, Type.Type<Scalar>> => {
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

const value = <T extends Scalar>(v: Value<T>, params: Expr.Expr<unknown>, type: Type.Type<T>): T | Expr.Expr<T> =>
  v.k === "lit" ? v.v : Expr.checkedProp(params, v.name, type)

const condition = (row: Expr.Expr<unknown>, c: Cond, params: Expr.Expr<unknown>): Expr.In<boolean> => {
  switch (c.k) {
    case "cmp":
      switch (c.kind) {
        case "number":
          return comparisons[c.op](Expr.checkedProp(row, c.col.key, c.col.type), value(c.value, params, c.col.type))
        case "string":
          return comparisons[c.op](Expr.checkedProp(row, c.col.key, c.col.type), value(c.value, params, c.col.type))
        case "boolean":
          return comparisons[c.op](Expr.checkedProp(row, c.col.key, c.col.type), value(c.value, params, c.col.type))
      }
    case "and":
      return c.items.reduce<Expr.In<boolean>>((a, item) => Expr.and(a, condition(row, item, params)), true)
    case "or":
      return c.items.reduce<Expr.In<boolean>>((a, item) => Expr.or(a, condition(row, item, params)), false)
    case "not":
      return Expr.not(condition(row, c.item, params))
    case "in":
      switch (c.kind) {
        case "number":
          return c.values.reduce<Expr.In<boolean>>((a, v) => Expr.or(a, Expr.eq(Expr.checkedProp(row, c.col.key, c.col.type), v)), false)
        case "string":
          return c.values.reduce<Expr.In<boolean>>((a, v) => Expr.or(a, Expr.eq(Expr.checkedProp(row, c.col.key, c.col.type), v)), false)
      }
  }
}

export const lower = (plan: QueryPlan, table: Table) => {
  validateColumns(plan, table)
  const Row = Type.object(Object.fromEntries(Object.entries(table.columns).map(([key, column]): [string, Type.Type<Scalar>] => [key, column.type])))
  const Params = Type.object(placeholderTypes(plan.where))
  const select = plan.select
  const Output = select
    ? Type.object(Object.fromEntries(Object.entries(select).map(([key, column]): [string, Type.Type<Scalar>] => [key, column.type])))
    : Row
  const project = (row: Expr.Expr<Row>): Expr.Expr<Row> =>
    select
      ? Expr.object(
        Object.fromEntries(
          Object.entries(select).map(([out, column]): [string, Expr.Expr<Scalar>] => [out, Expr.checkedProp<Scalar>(row, column.key, column.type)]),
        ),
      )
      : row
  const push = (array: Expr.Expr<Row[]>, item: Expr.Expr<Row>) => Stmt.do(Expr.call(Expr.prop(array, "push"), item))

  return Program.build(function*() {
    return yield* Decl.fn("query", {
      params: [Expr.param("rows", Type.array(Row)), Expr.param("params", Params)],
      body: function*({ rows, params }) {
        if (plan.orderBy.length === 0 || plan.limit === 0) {
          const out = yield* Decl.const("out", Expr.array(), Type.array(Output))
          if (plan.limit === 0) return out
          const skipped = plan.offset > 0 ? yield* Decl.let("skipped", 0) : null
          yield* Stmt.forOf("row", rows, function*(row) {
            if (plan.where) {
              yield* Stmt.if(Expr.not(condition(row, plan.where, params)), function*() {
                yield* Stmt.continue()
              })
            }
            if (skipped) {
              yield* Stmt.if(Expr.lt(skipped, plan.offset), function*() {
                yield* Stmt.assign(skipped, Expr.add(skipped, 1))
                yield* Stmt.continue()
              })
            }
            yield* push(out, project(row))
            if (plan.limit !== null) {
              yield* Stmt.if(Expr.gte(Expr.prop(out, "length"), plan.limit), function*() {
                yield* Stmt.break()
              })
            }
          })
          return out
        }

        const matched = yield* Decl.const("matched", Expr.array(), Type.array(Row))
        yield* Stmt.forOf("row", rows, function*(row) {
          if (plan.where) {
            yield* Stmt.if(condition(row, plan.where, params), function*() {
              yield* push(matched, row)
            })
          } else {
            yield* push(matched, row)
          }
        })
        const comparator = Expr.arrow({
          params: [Expr.param("a", Row), Expr.param("b", Row)],
          body: function*({ a, b }) {
            return plan.orderBy.reduceRight<Expr.In<number>>((rest, order) => {
              const [before, after] = order.dir === "asc" ? [-1, 1] : [1, -1]
              switch (order.col.kind) {
                case "number": {
                  const x = Expr.checkedProp(a, order.col.key, order.col.type)
                  const y = Expr.checkedProp(b, order.col.key, order.col.type)
                  return Expr.cond(Expr.lt(x, y), before, Expr.cond(Expr.gt(x, y), after, rest))
                }
                case "string": {
                  const x = Expr.checkedProp(a, order.col.key, order.col.type)
                  const y = Expr.checkedProp(b, order.col.key, order.col.type)
                  return Expr.cond(Expr.lt(x, y), before, Expr.cond(Expr.gt(x, y), after, rest))
                }
                case "boolean": {
                  const x = Expr.checkedProp(a, order.col.key, order.col.type)
                  const y = Expr.checkedProp(b, order.col.key, order.col.type)
                  return Expr.cond(Expr.neq(x, y), Expr.cond(x, after, before), rest)
                }
              }
            }, 0)
          },
        })
        yield* Stmt.do(Expr.call(Expr.prop(matched, "sort"), comparator))
        const end = plan.limit === null ? Expr.prop(matched, "length") : plan.offset + plan.limit
        const page = yield* Decl.const("page", Expr.call(Expr.prop(matched, "slice"), plan.offset, end), Type.array(Row))
        if (!select) return page
        const result = yield* Decl.const("result", Expr.array(), Type.array(Output))
        yield* Stmt.forOf("row", page, function*(row) {
          yield* push(result, project(row))
        })
        return result
      },
    })
  })
}
