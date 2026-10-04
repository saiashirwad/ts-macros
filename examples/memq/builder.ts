import { emitProgram } from "../../targets/javascript/index.ts"
import { lower } from "./lower.ts"
import type { Cond, Literal, Order } from "./ops.ts"
import { optimize, type QueryPlan } from "./plan.ts"
import type { Column, InferRow, Table } from "./schema.ts"

type Selection = Readonly<Record<string, Column<any>>>
type InferSelection<S extends Selection> = { [K in keyof S]: S[K] extends Column<infer V> ? V : never }
type Params = Readonly<Record<string, Literal>>
type Compiled<Row> = (rows: readonly object[], params: Params) => Row[]

const cache = new Map<string, { run: Compiled<object>; source: string }>()

const compile = (plan: QueryPlan, table: Table) => {
  const key = JSON.stringify(plan)
  const hit = cache.get(key)
  if (hit) return hit
  const source = emitProgram(lower(plan, table))
  // SAFETY: the emitted program declares `query(rows, params)`, which returns
  // the projected rows that `lower` built from this plan.
  const run = new Function(`${source}\nreturn query`)() as Compiled<object>
  const compiled = { run, source }
  cache.set(key, compiled)
  return compiled
}
export interface Prepared<Row> {
  readonly execute: (params?: Params) => Row[]
}
export interface From<Row> {
  readonly from: (table: Table) => Query<Row>
}

export interface FromTable {
  readonly from: <T extends Table>(table: T) => Query<InferRow<T>>
}

export class Query<Row> {
  readonly #plan: QueryPlan
  readonly #table: Table
  readonly #rows: readonly object[]

  constructor(plan: QueryPlan, table: Table, rows: readonly object[]) {
    this.#plan = plan
    this.#table = table
    this.#rows = rows
  }

  #next(patch: Partial<QueryPlan>): Query<Row> {
    return new Query<Row>({ ...this.#plan, ...patch }, this.#table, this.#rows)
  }

  where(cond: Cond): Query<Row> {
    return this.#next({ where: cond })
  }
  orderBy(...orders: Order[]): Query<Row> {
    return this.#next({ orderBy: orders })
  }
  limit(n: number): Query<Row> {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("limit must be a nonnegative safe integer")
    return this.#next({ limit: n })
  }
  offset(n: number): Query<Row> {
    if (!Number.isSafeInteger(n) || n < 0) throw new RangeError("offset must be a nonnegative safe integer")
    return this.#next({ offset: n })
  }

  prepare(): Prepared<Row> {
    const { run } = compile(optimize(this.#plan), this.#table)
    const rows = this.#rows
    // SAFETY: `run` projects each row to exactly the columns `Row` was inferred from.
    return { execute: (params = {}) => run(rows, params) as Row[] }
  }
  execute(params?: Params): Row[] {
    return this.prepare().execute(params)
  }
  toCode(): string {
    return compile(optimize(this.#plan), this.#table).source
  }
}

const planFor = (table: Table, select: QueryPlan["select"]): QueryPlan => ({
  table: table.name,
  select,
  where: null,
  orderBy: [],
  limit: null,
  offset: 0,
})

export class Db {
  readonly #data: Readonly<Record<string, readonly object[]>>

  constructor(data: Readonly<Record<string, readonly object[]>>) {
    this.#data = data
  }

  #rows(table: Table): readonly object[] {
    const rows = this.#data[table.name]
    if (!rows) throw new Error(`no rows for table ${table.name}`)
    return rows
  }

  select<S extends Selection>(selection: S): From<InferSelection<S>> {
    const keys = Object.fromEntries(Object.entries(selection).map(([out, column]) => [out, column.key]))
    return { from: (table) => new Query(planFor(table, keys), table, this.#rows(table)) }
  }

  selectAll(): FromTable {
    return { from: (table) => new Query(planFor(table, null), table, this.#rows(table)) }
  }
}

export const memdb = (data: Readonly<Record<string, readonly object[]>>): Db => new Db(data)
