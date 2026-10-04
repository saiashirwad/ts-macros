import assert from "node:assert/strict"
import { test } from "node:test"

import { memdb } from "../examples/memq/builder.ts"
import { and, asc, desc, eq, gt, gte, inArray, not, or, placeholder } from "../examples/memq/ops.ts"
import { enumOf, number, table, text } from "../examples/memq/schema.ts"

const users = table("users", { name: text(), age: number(), country: text(), plan: enumOf("free", "pro"), spend: number() })
const { columns: u } = users

type User = { name: string; age: number; country: string; plan: "free" | "pro"; spend: number }
const rows: User[] = Array.from({ length: 500 }, (_, i) => ({
  name: `user${i}`,
  age: i % 70,
  country: ["IN", "US", "DE", "BR"][i % 4] ?? "IN",
  plan: i % 3 ? "pro" : "free",
  spend: (i * 37) % 2000,
}))
const db = memdb({ users: rows })

test("a filter matches the same predicate written by hand", () => {
  const got = db.selectAll().from(users)
    .where(and(gte(u.age, 18), inArray(u.country, ["IN", "BR"]), or(eq(u.plan, "pro"), gt(u.spend, 1000))))
    .execute()
  const want = rows.filter((r) => r.age >= 18 && (r.country === "IN" || r.country === "BR") && (r.plan === "pro" || r.spend > 1000))
  assert.deepEqual(got, want)
})

test("select projects, orderBy sorts by every column, limit and offset page", () => {
  const got = db.select({ name: u.name, spend: u.spend }).from(users)
    .where(not(eq(u.country, "US")))
    .orderBy(desc(u.spend), asc(u.age))
    .offset(2)
    .limit(4)
    .execute()
  const want = rows
    .filter((r) => r.country !== "US")
    .sort((a, b) => b.spend - a.spend || a.age - b.age)
    .slice(2, 6)
    .map((r) => ({ name: r.name, spend: r.spend }))
  assert.deepEqual(got, want)
})

test("an unsorted limit stops scanning early", () => {
  let reads = 0
  const counted = rows.map((row) => ({
    ...row,
    get country() {
      reads++
      return row.country
    },
  }))
  const got = memdb({ users: counted }).select({ name: u.name }).from(users).where(eq(u.country, "DE")).limit(5).execute()
  assert.deepEqual(got, rows.filter((row) => row.country === "DE").slice(0, 5).map((row) => ({ name: row.name })))
  assert.equal(reads, 19)
})

test("a zero limit returns no rows with or without sorting", () => {
  assert.deepEqual(db.selectAll().from(users).limit(0).execute(), [])
  assert.deepEqual(db.selectAll().from(users).orderBy(asc(u.age)).limit(0).execute(), [])
})

test("empty conditions use their boolean identities", () => {
  assert.deepEqual(db.selectAll().from(users).where(and()).execute(), rows)
  assert.deepEqual(db.selectAll().from(users).where(or()).execute(), [])
  assert.deepEqual(db.selectAll().from(users).where(inArray(u.country, [])).execute(), [])
  assert.deepEqual(db.selectAll().from(users).where(not(or())).execute(), rows)
})

test("limit and offset reject values that are not nonnegative safe integers", () => {
  const query = db.selectAll().from(users)
  for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => query.limit(value), RangeError)
    assert.throws(() => query.offset(value), RangeError)
  }
})

test("an unsorted offset counts matching rows before projecting", () => {
  const got = db.select({ name: u.name }).from(users).where(eq(u.country, "DE")).offset(2).limit(3).execute()
  const want = rows.filter((row) => row.country === "DE").slice(2, 5).map((row) => ({ name: row.name }))
  assert.deepEqual(got, want)
})

test("a placeholder becomes a typed parameter, so one function serves every value", () => {
  const byAge = db.selectAll().from(users).where(gte(u.age, placeholder<number>("minAge"))).prepare()
  assert.deepEqual(byAge.execute({ minAge: 60 }), rows.filter((r) => r.age >= 60))
  assert.deepEqual(byAge.execute({ minAge: 69 }), rows.filter((r) => r.age >= 69))
  const source = db.selectAll().from(users).where(gte(u.age, placeholder<number>("minAge"))).toCode()
  assert.match(source, /^function query\(rows, params\)/)
  const query = new Function(`${source}\nreturn query`)()
  assert.deepEqual(query(rows, { minAge: 60 }), rows.filter((r) => r.age >= 60))
  assert.deepEqual(query(rows, { minAge: 69 }), rows.filter((r) => r.age >= 69))
})

test("nested and/or flatten before code is generated", () => {
  const code = db.selectAll().from(users).where(and(and(gte(u.age, 1), gte(u.age, 2)), gte(u.age, 3))).toCode()
  assert.match(code, /row\.age >= 1 && row\.age >= 2 && row\.age >= 3/)
})

const typeChecks = () => {
  const [first] = db.select({ name: u.name }).from(users).execute()
  const name: string | undefined = first?.name
  // @ts-expect-error: age was not selected
  void first?.age
  // @ts-expect-error: "gold" is not a plan
  eq(u.plan, "gold")
  // @ts-expect-error: age is a number
  gte(u.age, "18")
  return name
}
void typeChecks
