import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

test("empty-array initializers require an annotation", () => {
  assert.throws(() => {
    // @ts-expect-error an unannotated empty-array const is not supported
    $.const("xs", [])
  }, /empty-array initializer needs an annotation/)
  assert.throws(() => {
    // @ts-expect-error an unannotated empty-array let is not supported
    $.let("xs", [])
  }, /empty-array initializer needs an annotation/)
  assert.throws(() => {
    // @ts-expect-error the rule also applies to an explicit array node
    $.const("xs", $.array())
  }, /empty-array initializer needs an annotation/)
  assert.throws(() => {
    // @ts-expect-error the rule also applies to an explicit array node
    $.let("xs", $.array())
  }, /empty-array initializer needs an annotation/)
})

test("annotated empty initializers and unannotated empty returns remain valid", () => {
  const program = $.build(function*() {
    yield* $.const("xs", [], $.Array($.String))
    yield* $.let("ys", $.array(), $.Array($.Number))
    return yield* $.fn("empty", {
      body: function*() {
        return []
      },
    })
  })
  assert.equal(emitProgram(program), "const xs: string[] = [];\nlet ys: number[] = [];\nfunction empty() {\n  return [];\n}")
})
