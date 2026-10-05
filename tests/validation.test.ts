import assert from "node:assert/strict"
import { test } from "node:test"
import { compile, ValidationError } from "../examples/validation/compile.ts"
import { runtime } from "../examples/validation/runtime.ts"
import { type Infer, schema } from "../examples/validation/schema.ts"

const Person = schema.object({
  name: schema.string(1),
  age: schema.number(0, true),
  tags: schema.array(schema.string()),
  address: schema.object({ city: schema.string(), zip: schema.optional(schema.number()) }),
  nickname: schema.optional(schema.string()),
})

test("schema compiler infers nested output and optional properties", () => {
  const parsed: Infer<typeof Person> = compile(Person).parse({ name: "Ada", age: 36, tags: [], address: { city: "London" } })
  const expected: { name: string; age: number; tags: string[]; address: { city: string; zip?: number | undefined }; nickname?: string | undefined } =
    parsed
  const roundTrip: Infer<typeof Person> = expected
  assert.deepEqual(roundTrip.address, { city: "London" })
  // @ts-expect-error age is inferred as number.
  const wrongAge: Infer<typeof Person> = { name: "Ada", age: "36", tags: [], address: { city: "London" } }
  assert.equal(wrongAge.age, "36")
  // @ts-expect-error required fields cannot be omitted.
  const missing: Infer<typeof Person> = { age: 36, tags: [], address: { city: "London" } }
  assert.equal(Object.hasOwn(missing, "name"), false)
})

test("compiled objects strip extras and preserve optional presence", () => {
  const validator = compile(schema.object({ name: schema.string(), alias: schema.optional(schema.string()) }))
  const absent = validator.parse({ name: "Ada", extra: 1 })
  assert.deepEqual(absent, { name: "Ada" })
  assert.equal(Object.hasOwn(absent, "alias"), false)
  const present = validator.parse({ name: "Ada", alias: undefined })
  assert.equal(Object.hasOwn(present, "alias"), true)
  assert.equal(present.alias, undefined)
})

test("issues accumulate with independent nested paths", () => {
  const validator = compile(Person)
  const input = { name: "", age: -1.5, tags: ["valid", 2, false], address: { city: 5, zip: "bad" }, nickname: 2 }
  const result = validator.safeParse(input)
  assert.equal(result.success, false)
  if (result.success) throw new Error("expected failure")
  assert.deepEqual(result.issues.map(({ path }) => path), [["name"], ["age"], ["tags", 1], ["tags", 2], ["address", "city"], ["address", "zip"], [
    "nickname",
  ]])
  assert.throws(
    () => validator.parse(input),
    (error) => error instanceof ValidationError && JSON.stringify(error.issues) === JSON.stringify(result.issues),
  )
})

test("invalid containers report one issue and skip descendants", () => {
  const validator = compile(schema.object({ nested: schema.object({ field: schema.boolean() }), items: schema.array(schema.number()) }))
  const result = validator.safeParse({ nested: [], items: null })
  assert.deepEqual(result, { success: false, issues: [{ path: ["nested"], expected: "object" }, { path: ["items"], expected: "array" }] })
  for (const value of [null, [], false, undefined]) {
    assert.deepEqual(validator.safeParse(value), { success: false, issues: [{ path: [], expected: "object" }] })
  }
})

test("scalars validate finite numbers, exact literals, and optional roots", () => {
  const number = compile(schema.number())
  for (const value of [NaN, Infinity, -Infinity, "1"]) assert.equal(number.safeParse(value).success, false)
  assert.equal(number.parse(-1.5), -1.5)
  assert.equal(compile(schema.literal(null)).parse(null), null)
  assert.equal(compile(schema.literal("member")).safeParse("admin").success, false)
  assert.equal(compile(schema.literal(2)).parse(2), 2)
  assert.equal(compile(schema.literal(true)).parse(true), true)
  assert.equal(compile(schema.optional(schema.boolean())).parse(undefined), undefined)
  assert.deepEqual(compile(schema.object({})).parse({ extra: 1 }), {})
  assert.throws(() => schema.literal(NaN), RangeError)
  assert.throws(() => schema.string(-1), RangeError)
  assert.throws(() => schema.number(Infinity), RangeError)
})

test("only own input fields are read and getters are read once", () => {
  const validator = compile(schema.object({ name: schema.string() }))
  assert.equal(validator.safeParse(Object.create({ name: "inherited" })).success, false)
  let reads = 0
  assert.deepEqual(
    validator.parse({
      get name() {
        reads++
        return "Ada"
      },
    }),
    { name: "Ada" },
  )
  assert.equal(reads, 1)
})

test("inherited getters are ignored and missing required fields validate undefined", () => {
  const validator = compile(schema.object({ name: schema.string(), alias: schema.optional(schema.string()) }))
  const prototype = {
    get name() {
      throw new Error("inherited required getter must not run")
    },
    get alias() {
      throw new Error("inherited optional getter must not run")
    },
  }
  assert.deepEqual(validator.safeParse(Object.create(prototype)), {
    success: false,
    issues: [{ path: ["name"], expected: "string with at least 0 characters" }],
  })
  const input = Object.create(prototype)
  Object.defineProperty(input, "name", { value: "Ada" })
  assert.deepEqual(validator.parse(input), { name: "Ada" })
})

test("object guards preserve proxy ownership/read order without invoking has traps", () => {
  const validator = compile(schema.object({ name: schema.string(), alias: schema.optional(schema.string()) }))
  const events: string[] = []
  const input = new Proxy({ name: "Ada", alias: undefined }, {
    has() {
      throw new Error("in checks must not run")
    },
    getOwnPropertyDescriptor(target, key) {
      events.push(`own:${String(key)}`)
      return Object.getOwnPropertyDescriptor(target, key)
    },
    get(target, key) {
      events.push(`read:${String(key)}`)
      return key === "name" ? target.name : target.alias
    },
  })
  assert.deepEqual(validator.parse(input), { name: "Ada", alias: undefined })
  assert.deepEqual(events, ["own:name", "read:name", "own:alias", "own:alias", "read:alias"])

  const error = new Error("proxy failed")
  for (
    const handler of [{
      getOwnPropertyDescriptor() {
        throw error
      },
    }, {
      get() {
        throw error
      },
    }]
  ) {
    assert.throws(() => validator.safeParse(new Proxy({ name: "Ada" }, handler)), (thrown) => thrown === error)
  }
})

test("optional values validate null and input getter exceptions propagate", () => {
  const nullable = compile(schema.optional(schema.literal(null)))
  assert.equal(nullable.parse(undefined), undefined)
  assert.equal(nullable.parse(null), null)
  assert.deepEqual(compile(schema.optional(schema.string())).safeParse(null), {
    success: false,
    issues: [{ path: [], expected: "string with at least 0 characters" }],
  })
  const validator = compile(schema.object({ name: schema.string() }))
  const error = new Error("getter failed")
  assert.throws(() =>
    validator.safeParse({
      get name() {
        throw error
      },
    }), (thrown) => thrown === error)
})

test("computed __proto__ fields become own data without changing prototype", () => {
  const validator = compile(schema.object({ ["__proto__"]: schema.string(), constructor: schema.number() }))
  const result = validator.parse({ ["__proto__"]: "data", constructor: 3 })
  assert.equal(Object.getPrototypeOf(result), Object.prototype)
  assert.equal(Object.hasOwn(result, "__proto__"), true)
  assert.equal(result.__proto__, "data")
  assert.equal(result.constructor, 3)
  assert.deepEqual(validator.safeParse({ constructor: 3 }), {
    success: false,
    issues: [{ path: ["__proto__"], expected: "string with at least 0 characters" }],
  })
  const optional = compile(schema.object({ ["__proto__"]: schema.optional(schema.string()) }))
  assert.deepEqual(optional.parse({}), {})
  const present = optional.parse({ ["__proto__"]: undefined })
  assert.equal(Object.getPrototypeOf(present), Object.prototype)
  assert.equal(Object.hasOwn(present, "__proto__"), true)
  assert.equal(present.__proto__, undefined)
})

test("each scalar and object schema emits a single failure statement", () => {
  const validator = compile(schema.object({
    name: schema.string(1),
    age: schema.number(0, true),
    nickname: schema.optional(schema.string()),
  }))
  assert.equal(validator.toCode().match(/issues\.push\(/g)?.length, 4)
  for (const input of [{ name: false, age: "36", nickname: 2 }, { name: "", age: -1.5, nickname: null }]) {
    assert.deepEqual(validator.safeParse(input), {
      success: false,
      issues: [
        { path: ["name"], expected: "string with at least 1 characters" },
        { path: ["age"], expected: "finite integer >= 0" },
        { path: ["nickname"], expected: "string with at least 0 characters" },
      ],
    })
  }
})

test("printed source executes directly with its documented runtime binding", () => {
  const validator = compile(Person)
  const execute = new Function("runtime", validator.toCode())(runtime)
  const input = { name: "Ada", age: 36, tags: ["math"], address: { city: "London" } }
  assert.deepEqual(execute(input), validator.safeParse(input))
  assert.deepEqual(execute({}), validator.safeParse({}))
  assert.equal(validator.toCode().includes("schema.kind"), false)
})

test("schema fields cannot disappear between inference and compilation", () => {
  const symbolFields = { [Symbol("required")]: schema.string() }
  const hidden = { required: schema.string() }
  Object.defineProperty(hidden, "required", { enumerable: false })
  const inherited = { required: schema.string() }
  Object.setPrototypeOf(inherited, { required: schema.string() })
  Reflect.deleteProperty(inherited, "required")
  let reads = 0
  const accessor = {
    get required() {
      reads++
      return schema.string()
    },
  }
  for (const fields of [symbolFields, hidden, inherited, accessor]) {
    assert.throws(() => schema.object(fields), TypeError)
    assert.throws(() => compile({ kind: "object", fields }), TypeError)
  }
  assert.equal(reads, 0)
})

test("compiled validators retain their checked runtime operations", () => {
  const validator = compile(schema.string())
  assert.throws(() => Object.assign(runtime, { stringAtLeast: () => true }), TypeError)
  assert.equal(validator.safeParse(123).success, false)
})

test("a possibly optional field does not promise presence", () => {
  function maybeOptional(optional: boolean) {
    return optional ? schema.optional(schema.string()) : schema.string()
  }
  const field = maybeOptional(true)
  const object = schema.object({ field })
  const empty: Infer<typeof object> = {}
  assert.deepEqual(compile(object).parse({}), empty)
})
