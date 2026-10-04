import { memdb } from "./builder.ts"
import { and, desc, eq, gt, gte, inArray, or, placeholder } from "./ops.ts"
import { enumOf, number, table, text } from "./schema.ts"

const users = table("users", {
  name: text(),
  age: number(),
  country: text(),
  plan: enumOf("free", "pro"),
  spend: number(),
})
const { columns: u } = users

const countries = ["IN", "US", "DE", "BR"]
const rows = Array.from({ length: 500 }, (_, i) => ({
  name: `user${i}`,
  age: i % 70,
  country: countries[i % 4],
  plan: i % 2 ? "pro" : "free",
  spend: (i * 37) % 2000,
}))
const db = memdb({ users: rows })

const top = db
  .select({ name: u.name, spend: u.spend })
  .from(users)
  .where(and(gte(u.age, 18), inArray(u.country, ["IN", "BR"]), or(eq(u.plan, "pro"), gt(u.spend, 1000))))
  .orderBy(desc(u.spend), desc(u.age))
  .limit(3)

console.log(`-- generated (sorted) --\n${top.toCode()}`)
console.log("result:", top.execute())

const firstFive = db.select({ name: u.name }).from(users).where(eq(u.country, "DE")).limit(5)
console.log(`\n-- generated (unsorted) --\n${firstFive.toCode()}`)
console.log("result:", firstFive.execute())

const byAge = db.selectAll().from(users).where(gte(u.age, placeholder<number>("minAge"))).limit(2).prepare()
console.log("\nprepared:", byAge.execute({ minAge: 65 }))
