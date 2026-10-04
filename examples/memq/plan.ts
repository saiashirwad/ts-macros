import type { Cond, Order } from "./ops.ts"

export interface QueryPlan {
  readonly table: string
  readonly select: Readonly<Record<string, string>> | null
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
