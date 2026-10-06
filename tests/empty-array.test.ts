import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

test("empty-array initializers require an annotation", () => {
  assert.throws(() => {
    // @ts-expect-error an unannotated empty-array const is not supported
    T.const("xs", [])
  }, /empty-array initializer needs an annotation/)
  assert.throws(() => {
    // @ts-expect-error an unannotated empty-array let is not supported
    T.let("xs", [])
  }, /empty-array initializer needs an annotation/)
  assert.throws(() => {
    // @ts-expect-error the rule also applies to an explicit array node
    T.const("xs", T.arrayLiteral())
  }, /empty-array initializer needs an annotation/)
  assert.throws(() => {
    // @ts-expect-error the rule also applies to an explicit array node
    T.let("xs", T.arrayLiteral())
  }, /empty-array initializer needs an annotation/)
})

test("annotated empty initializers and unannotated empty returns remain valid", () => {
  const program = T.build(function*() {
    yield* T.const("xs", [], T.Array(T.String))
    yield* T.let("ys", T.arrayLiteral(), T.Array(T.Number))
    return yield* T.fn("empty", {
      body: function*() {
        return []
      },
    })
  })
  assert.equal(emitProgram(program), "const xs: string[] = [];\nlet ys: number[] = [];\nfunction empty() {\n  return [];\n}")
})
