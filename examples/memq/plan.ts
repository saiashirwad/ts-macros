import type { Cond, Order } from "./ops.ts"
import type { AnyColumn, Table } from "./schema.ts"

export interface QueryPlan {
  readonly table: string
  readonly select: Readonly<Record<string, AnyColumn>> | null
  readonly where: Cond | null
  readonly orderBy: readonly Order[]
  readonly limit: number | null
  readonly offset: number
}

export const optimize = (plan: QueryPlan): QueryPlan => ({ ...plan, where: plan.where && simplify(plan.where) })

const simplify = (cond: Cond): Cond => {
  switch (cond.k) {
    case "and":
    case "or": {
      const items = cond.items.map(simplify).flatMap((item) => item.k === cond.k ? item.items : [item])
      return items.length === 1 && items[0] ? items[0] : { k: cond.k, items }
    }
    case "not":
      return cond.item.k === "not" ? simplify(cond.item.item) : { k: "not", item: simplify(cond.item) }
    default:
      return cond
  }
}

export const validateColumns = (plan: QueryPlan, table: Table): void => {
  const check = (column: AnyColumn) => {
    if (table.columns[column.key] !== column) throw new Error(`column ${column.table}.${column.key} does not belong to table ${table.name}`)
  }
  const condition = (cond: Cond): void => {
    switch (cond.k) {
      case "cmp":
      case "in":
        check(cond.col)
        return
      case "and":
      case "or":
        cond.items.forEach(condition)
        return
      case "not":
        condition(cond.item)
        return
    }
  }
  if (plan.select) Object.values(plan.select).forEach(check)
  if (plan.where) condition(plan.where)
  plan.orderBy.forEach((order) => check(order.col))
}
