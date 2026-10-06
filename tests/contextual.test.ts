import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("assignment and call targets see fresh object fields before widening", () => {
  assert.equal(emitProgram(cases.assignLiteralObject.program), "obj.x = { ok: true };\nconst actual = 1;")
  assert.equal(emitProgram(cases.callLiteralObject.program), "const actual = consume({ ok: true });")
  const expression = $.object({ ok: true })
  assertType<Equal<$.Denotes<typeof expression>, { ok: boolean }>>()
  assert.equal($.assign($.prop($.hostValue<{ x: { ok: true } }>("obj"), "x"), expression).kind, "assign")
  assert.equal($.call($.hostValue<(v: { ok: true }) => number>("consume"), { ok: true }).kind, "call")
})

const invalidContextualValues = () => {
  const target = $.prop($.hostValue<{ x: { ok: true } }>("obj"), "x")
  const consume = $.hostValue<(v: { ok: true }) => number>("consume")
  // @ts-expect-error a wrong literal does not satisfy the contextual target
  $.assign(target, { ok: false })
  // @ts-expect-error a wrong literal node does not satisfy the parameter
  $.call(consume, $.object({ ok: false }))
  // @ts-expect-error fresh fallback must retain excess-property checking
  $.assign(target, { ok: true, extra: 1 })
  // @ts-expect-error recovering fresh fields must not admit an excess-property literal
  $.call(consume, $.object({ ok: true, extra: 1 }))
  // @ts-expect-error fresh nested arrays must not hide excess object fields
  $.call($.hostValue<(v: { ok: true }[]) => number>("consume"), $.array($.object({ ok: true, extra: 1 })))
  // @ts-expect-error fresh fields do not repair an argument's wrong primitive type
  $.call($.hostValue<(v: number) => number>("consume"), $.string("wrong"))
  // @ts-expect-error required argument counts remain enforced
  $.call(consume)
  // @ts-expect-error extra arguments remain forbidden
  $.call(consume, $.object({ ok: true }), 1)
  $.build(function*() {
    const stored = yield* $.const("stored", $.object({ ok: true }))
    // @ts-expect-error a stored boolean field is not a fresh true literal
    yield* $.assign(target, stored)
    // @ts-expect-error call targets cannot re-narrow a stored object's fields
    $.call(consume, stored)
    return stored
  })
}
void invalidContextualValues
