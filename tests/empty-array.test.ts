import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, Program, Type } from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

test("empty-array initializers require an annotation", () => {
  assert.throws(() => {
    // @ts-expect-error an unannotated empty-array const is not supported
    Decl.const_("xs", [])
  }, /empty-array initializer needs an annotation/)
  assert.throws(() => {
    // @ts-expect-error an unannotated empty-array let is not supported
    Decl.let_("xs", [])
  }, /empty-array initializer needs an annotation/)
  assert.throws(() => {
    // @ts-expect-error the rule also applies to an explicit array node
    Decl.const_("xs", Expr.array())
  }, /empty-array initializer needs an annotation/)
  assert.throws(() => {
    // @ts-expect-error the rule also applies to an explicit array node
    Decl.let_("xs", Expr.array())
  }, /empty-array initializer needs an annotation/)
})

test("annotated empty initializers and unannotated empty returns remain valid", () => {
  const program = Program.build(function*() {
    yield* Decl.const_("xs", [], Type.array(Type.string))
    yield* Decl.let_("ys", Expr.array(), Type.array(Type.number))
    return yield* Decl.fn("empty", {
      body: function*() {
        return []
      },
    })
  })
  assert.equal(emitProgram(program), "const xs: string[] = [];\nlet ys: number[] = [];\nfunction empty() {\n  return [];\n}")
})
