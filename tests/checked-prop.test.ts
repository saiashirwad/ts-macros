import assert from "node:assert/strict"
import { test } from "node:test"
import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/js.ts"

const object = $.paramBindings([$.param("row", $.Object({ age: $.Number, name: $.String }))]).row

test("checked property projection verifies its witness before generating JavaScript", () => {
  const program = $.build(function*() {
    return yield* $.fn("read", {
      params: [$.param("row", $.Object({ age: $.Number }))],
      body: function*({ row }) {
        return $.add($.checkedProp(row, "age", $.Number), 1)
      },
    })
  })
  const code = emitProgram(program)
  assert.match(code, /return row\.age \+ 1/)
  const run = new Function(`${code}\nreturn read`)()
  assert.equal(run({ age: 41 }), 42)
})

test("checked property projection rejects a missing or incompatible type witness", () => {
  assert.throws(() => $.checkedProp(object, "age", $.String), /does not match/)
  assert.throws(() => $.checkedProp(object, "missing", $.Number), /own field/)
  assert.throws(() => $.checkedProp(object, "toString", $.String), /own field/)
  const optional = $.paramBindings([$.param("row", $.Object({ age: $.Optional($.Number) }))]).row
  assert.throws(() => $.checkedProp(optional, "age", $.Number), /optional field/)
  const erased = $.paramBindings([$.param("value", $.Unknown)]).value
  assert.throws(() => $.checkedProp(erased, "age", $.Number), /concrete object metadata/)
  assert.throws(() => $.checkedProp($.hostValue<{ age: number }>("row"), "age", $.Number), /concrete object metadata/)
  assert.throws(() => $.checkedProp($.number(1), "age", $.Number), /concrete object metadata/)
})

const typeChecks = () => {
  const age = $.checkedProp(object, "age", $.Number)
  // @ts-expect-error: a numeric projection cannot be compared with text
  $.gt(age, "18")
  // @ts-expect-error: a read proof does not grant write access to an erased receiver
  $.assign(age, 19)
}
void typeChecks

test("checked property projection accepts structurally equal enum witnesses", () => {
  const descriptor = $.Union($.Literal("free"), $.Literal("pro"))
  const row = $.paramBindings([$.param("row", $.Object({ plan: descriptor }))]).row
  const projected = $.checkedProp(row, "plan", $.Union($.Literal("pro"), $.Literal("free")))
  assert.equal(projected.kind, "prop")
  assert.throws(() => $.checkedProp(row, "plan", $.String), /does not match/)
})

const containerTypeChecks = () => {
  const bindings = $.paramBindings([$.param("numbers", $.Array($.Number))])
  // @ts-expect-error: array push retains its element type
  $.call($.prop(bindings.numbers, "push"), "wrong")
  return $.build(function*() {
    const count = yield* $.let("count", 0)
    // @ts-expect-error: assignment retains its target type
    yield* $.assign(count, "wrong")
  })
}
void containerTypeChecks
