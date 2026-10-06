import assert from "node:assert/strict"
import { test } from "node:test"
import * as T from "../src/index.ts"
import { emitProgram } from "../targets/js.ts"

const object = T.paramBindings([T.param("row", T.Object({ age: T.Number, name: T.String }))]).row

test("checked property projection verifies its witness before generating JavaScript", () => {
  const program = T.build(function*() {
    return yield* T.fn("read", {
      params: [T.param("row", T.Object({ age: T.Number }))],
      body: function*({ row }) {
        return T.add(T.checkedProp(row, "age", T.Number), 1)
      },
    })
  })
  const code = emitProgram(program)
  assert.match(code, /return row\.age \+ 1/)
  const run = new Function(`${code}\nreturn read`)()
  assert.equal(run({ age: 41 }), 42)
})

test("checked property projection rejects a missing or incompatible type witness", () => {
  assert.throws(() => T.checkedProp(object, "age", T.String), /does not match/)
  assert.throws(() => T.checkedProp(object, "missing", T.Number), /own field/)
  assert.throws(() => T.checkedProp(object, "toString", T.String), /own field/)
  const optional = T.paramBindings([T.param("row", T.Object({ age: T.Optional(T.Number) }))]).row
  assert.throws(() => T.checkedProp(optional, "age", T.Number), /optional field/)
  const erased = T.paramBindings([T.param("value", T.Unknown)]).value
  assert.throws(() => T.checkedProp(erased, "age", T.Number), /concrete object metadata/)
  assert.throws(() => T.checkedProp(T.hostValue<{ age: number }>("row"), "age", T.Number), /concrete object metadata/)
  assert.throws(() => T.checkedProp(T.numberLiteral(1), "age", T.Number), /concrete object metadata/)
})

const typeChecks = () => {
  const age = T.checkedProp(object, "age", T.Number)
  // @ts-expect-error: a numeric projection cannot be compared with text
  T.gt(age, "18")
  // @ts-expect-error: a read proof does not grant write access to an erased receiver
  T.assign(age, 19)
}
void typeChecks

test("checked property projection accepts structurally equal enum witnesses", () => {
  const descriptor = T.Union(T.Literal("free"), T.Literal("pro"))
  const row = T.paramBindings([T.param("row", T.Object({ plan: descriptor }))]).row
  const projected = T.checkedProp(row, "plan", T.Union(T.Literal("pro"), T.Literal("free")))
  assert.equal(projected.kind, "prop")
  assert.throws(() => T.checkedProp(row, "plan", T.String), /does not match/)
})

const containerTypeChecks = () => {
  const bindings = T.paramBindings([T.param("numbers", T.Array(T.Number))])
  // @ts-expect-error: array push retains its element type
  T.call(T.prop(bindings.numbers, "push"), "wrong")
  return T.build(function*() {
    const count = yield* T.let("count", 0)
    // @ts-expect-error: assignment retains its target type
    yield* T.assign(count, "wrong")
  })
}
void containerTypeChecks
