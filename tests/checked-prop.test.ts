import assert from "node:assert/strict"
import { test } from "node:test"
import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/js.ts"

const object = Expr.paramBindings([Expr.param("row", Type.object({ age: Type.number, name: Type.string }))]).row

test("checked property projection verifies its witness before generating JavaScript", () => {
  const program = Program.build(function*() {
    return yield* Decl.fn("read", {
      params: [Expr.param("row", Type.object({ age: Type.number }))],
      body: function*({ row }) {
        return Expr.add(Expr.checkedProp(row, "age", Type.number), 1)
      },
    })
  })
  const code = emitProgram(program)
  assert.match(code, /return row\.age \+ 1/)
  const run = new Function(`${code}\nreturn read`)()
  assert.equal(run({ age: 41 }), 42)
})

test("checked property projection rejects a missing or incompatible type witness", () => {
  assert.throws(() => Expr.checkedProp(object, "age", Type.string), /does not match/)
  assert.throws(() => Expr.checkedProp(object, "missing", Type.number), /own field/)
  assert.throws(() => Expr.checkedProp(object, "toString", Type.string), /own field/)
  const optional = Expr.paramBindings([Expr.param("row", Type.object({ age: Type.optional(Type.number) }))]).row
  assert.throws(() => Expr.checkedProp(optional, "age", Type.number), /optional field/)
  const erased = Expr.paramBindings([Expr.param("value", Type.unknown)]).value
  assert.throws(() => Expr.checkedProp(erased, "age", Type.number), /concrete object metadata/)
  assert.throws(() => Expr.checkedProp(FFI.Value<{ age: number }>("row"), "age", Type.number), /concrete object metadata/)
  assert.throws(() => Expr.checkedProp(Expr.number(1), "age", Type.number), /concrete object metadata/)
})

const typeChecks = () => {
  const age = Expr.checkedProp(object, "age", Type.number)
  // @ts-expect-error: a numeric projection cannot be compared with text
  Expr.gt(age, "18")
  // @ts-expect-error: a read proof does not grant write access to an erased receiver
  Stmt.assign(age, 19)
}
void typeChecks

test("checked property projection accepts structurally equal enum witnesses", () => {
  const descriptor = Type.union(Type.literal("free"), Type.literal("pro"))
  const row = Expr.paramBindings([Expr.param("row", Type.object({ plan: descriptor }))]).row
  const projected = Expr.checkedProp(row, "plan", Type.union(Type.literal("pro"), Type.literal("free")))
  assert.equal(projected.kind, "prop")
  assert.throws(() => Expr.checkedProp(row, "plan", Type.string), /does not match/)
})

const containerTypeChecks = () => {
  const bindings = Expr.paramBindings([Expr.param("numbers", Type.array(Type.number))])
  // @ts-expect-error: array push retains its element type
  Expr.call(Expr.prop(bindings.numbers, "push"), "wrong")
  return Program.build(function*() {
    const count = yield* Decl.let_("count", 0)
    // @ts-expect-error: assignment retains its target type
    yield* Stmt.assign(count, "wrong")
  })
}
void containerTypeChecks
