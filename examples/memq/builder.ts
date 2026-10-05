import { emitProgram } from "../../targets/js.ts"
import { lower } from "./lower.ts"
import type { Cond, Literal, Order } from "./ops.ts"
import { optimize, type QueryPlan, validateColumns } from "./plan.ts"
import type { AnyColumn, Column, InferRow, Table } from "./schema.ts"

type Selection = Readonly<Record<string, AnyColumn>>
type InferSelection<S extends Selection> = { [K in keyof S]: S[K] extends Column<infer V> ? V : never }
type Params = Readonly<Record<string, Literal>>
type Compiled<Row> = (rows: readonly object[], params: Params) => Row[]

type Compilation = { run: Compiled<object>; source: string }
const cache = new WeakMap<Table, Map<string, Compilation>>()

const compile = (plan: QueryPlan, table: Table) => {
  validateColumns(plan, table)
  let tableCache = cache.get(table)
  if (!tableCache) {
    tableCache = new Map()
    cache.set(table, tableCache)
  }
  const key = JSON.stringify(plan)
  const hit = tableCache.get(key)
  if (hit) return hit
  const source = emitProgram(lower(plan, table))
  // SAFETY: `lower` emits this callable shape. Its output contract assumes
  // that the supplied rows and parameters satisfy their declared schema.
  const run = new Function(`${source}\nreturn query`)() as Compiled<object>
  const compiled = { run, source }
  tableCache.set(key, compiled)
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
    // SAFETY: the inferred projection is valid when rows and parameters match the schema.
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
    return { from: (table) => new Query(planFor(table, selection), table, this.#rows(table)) }
  }

  selectAll(): FromTable {
    return { from: (table) => new Query(planFor(table, null), table, this.#rows(table)) }
  }
}

export const memdb = (data: Readonly<Record<string, readonly object[]>>): Db => new Db(data)
