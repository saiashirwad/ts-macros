import { Decl, Expr, Program, Stmt, Type } from "../../src/index.ts"
import type { Comparison, Cond, Value } from "./ops.ts"
import type { QueryPlan } from "./plan.ts"
import type { Table } from "./schema.ts"

// SAFETY: runtime column keys cannot satisfy the constructors' literal-key checks.
// Program.build still validates scopes and control flow. See #49 for a typed dynamic API.
const uncheckedExpr = Expr as any
// SAFETY: the same dynamic-key boundary applies to statement constructors.
const uncheckedStmt = Stmt as any
// SAFETY: the same dynamic-key boundary applies to declaration constructors.
const uncheckedDecl = Decl as any

const comparisons = {
  "===": uncheckedExpr.eq,
  "!==": uncheckedExpr.neq,
  ">": uncheckedExpr.gt,
  ">=": uncheckedExpr.gte,
  "<": uncheckedExpr.lt,
  "<=": uncheckedExpr.lte,
} satisfies Record<Comparison, typeof uncheckedExpr.eq>

const columnType = (table: Table, key: string): Type.Type<any> => {
  const column = table.columns[key]
  if (!column) throw new Error(`unknown column ${table.name}.${key}`)
  return column.type
}
const placeholderTypes = (table: Table, cond: Cond | null, into: Record<string, Type.Type<any>> = {}) => {
  if (cond === null) return into
  if (cond.k === "cmp" && cond.value.k === "ph") into[cond.value.name] = columnType(table, cond.col)
  if (cond.k === "and" || cond.k === "or") { for (const item of cond.items) placeholderTypes(table, item, into) }
  if (cond.k === "not") placeholderTypes(table, cond.item, into)
  return into
}

export const lower = (plan: QueryPlan, table: Table) => {
  const Row = Type.object(Object.fromEntries(Object.keys(table.columns).map((key) => [key, columnType(table, key)])))
  const Params = Type.object(placeholderTypes(table, plan.where))

  const value = (v: Value, params: any) => (v.k === "lit" ? v.v : uncheckedExpr.prop(params, v.name))

  const cond = (row: any, c: Cond, params: any): any => {
    switch (c.k) {
      case "cmp":
        return comparisons[c.op](uncheckedExpr.prop(row, c.col), value(c.value, params))
      case "and":
        return c.items.length === 0 ? true : c.items.map((item) => cond(row, item, params)).reduce((a, b) => uncheckedExpr.and(a, b))
      case "or":
        return c.items.length === 0 ? false : c.items.map((item) => cond(row, item, params)).reduce((a, b) => uncheckedExpr.or(a, b))
      case "not":
        return uncheckedExpr.not(cond(row, c.item, params))
      case "in":
        return c.values.length === 0
          ? false
          : c.values.map((v) => uncheckedExpr.eq(uncheckedExpr.prop(row, c.col), v)).reduce((a, b) => uncheckedExpr.or(a, b))
    }
  }

  const select = plan.select
  const project = (row: any) =>
    select ? uncheckedExpr.object(Object.fromEntries(Object.entries(select).map(([out, key]) => [out, uncheckedExpr.prop(row, key)]))) : row
  const push = (array: any, item: any) => uncheckedStmt.do_(uncheckedExpr.call(uncheckedExpr.prop(array, "push"), item))
  const emptyRows = () => uncheckedDecl.const_("out", uncheckedExpr.array(), Type.array(Type.any))

  return Program.build(function*() {
    return yield* uncheckedDecl.fn("query", {
      params: [Expr.param("rows", Type.array(Row)), Expr.param("params", Params)],
      body: function*({ rows, params }: { rows: any; params: any }) {
        const out = yield* emptyRows()
        if (plan.limit === 0) return out

        if (plan.orderBy.length === 0) {
          const skipped = plan.offset > 0 ? yield* uncheckedDecl.let_("skipped", 0) : null
          yield* uncheckedStmt.forOf("row", rows, function*(row: any) {
            if (plan.where) {
              yield* uncheckedStmt.if_(uncheckedExpr.not(cond(row, plan.where, params)), function*() {
                yield* uncheckedStmt.continue_()
              })
            }
            if (skipped) {
              yield* uncheckedStmt.if_(uncheckedExpr.lt(skipped, plan.offset), function*() {
                yield* uncheckedStmt.assign(skipped, uncheckedExpr.add(skipped, 1))
                yield* uncheckedStmt.continue_()
              })
            }
            yield* push(out, project(row))
            if (plan.limit !== null) {
              yield* uncheckedStmt.if_(uncheckedExpr.gte(uncheckedExpr.prop(out, "length"), plan.limit), function*() {
                yield* uncheckedStmt.break_()
              })
            }
          })
          return out
        }

        yield* uncheckedStmt.forOf("row", rows, function*(row: any) {
          if (plan.where) {
            yield* uncheckedStmt.if_(cond(row, plan.where, params), function*() {
              yield* push(out, row)
            })
          } else {
            yield* push(out, row)
          }
        })
        const comparator = uncheckedExpr.arrow({
          params: [Expr.param("a", Row), Expr.param("b", Row)],
          body: function*({ a, b }: { a: any; b: any }) {
            return plan.orderBy.reduceRight<any>((rest, order) => {
              const [before, after] = order.dir === "asc" ? [-1, 1] : [1, -1]
              const x = uncheckedExpr.prop(a, order.col)
              const y = uncheckedExpr.prop(b, order.col)
              return uncheckedExpr.cond(uncheckedExpr.lt(x, y), before, uncheckedExpr.cond(uncheckedExpr.gt(x, y), after, rest))
            }, 0)
          },
        })
        yield* uncheckedStmt.do_(uncheckedExpr.call(uncheckedExpr.prop(out, "sort"), comparator))
        const end = plan.limit === null ? uncheckedExpr.prop(out, "length") : plan.offset + plan.limit
        const page = yield* uncheckedDecl.const_("page", uncheckedExpr.call(uncheckedExpr.prop(out, "slice"), plan.offset, end))
        if (!select) return page
        const result = yield* uncheckedDecl.const_("result", uncheckedExpr.array(), Type.array(Type.any))
        yield* uncheckedStmt.forOf("row", page, function*(row: any) {
          yield* push(result, project(row))
        })
        return result
      },
    })
  })
}
