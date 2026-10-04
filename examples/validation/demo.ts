import { compile } from "./compile.ts"
import { schema } from "./schema.ts"

const Person = schema.object({
  name: schema.string(1),
  age: schema.number(0, true),
  active: schema.boolean(),
  role: schema.literal("member"),
  tags: schema.array(schema.string()),
  nickname: schema.optional(schema.string()),
})
const person = compile(Person)
console.log(person.toCode())
console.log(person.parse({ name: "Ada", age: 36, active: true, role: "member", tags: ["math"], extra: "stripped" }))
console.log(person.safeParse({ name: "", age: -1.5, active: true, role: "admin", tags: ["math", 2] }))
