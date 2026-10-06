import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { cases } from "./exactness.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("assignment and call targets see fresh object fields before widening", () => {
  assert.equal(emitProgram(cases.assignLiteralObject.program), "obj.x = { ok: true };\nconst actual = 1;")
  assert.equal(emitProgram(cases.callLiteralObject.program), "const actual = consume({ ok: true });")
  const expression = T.objectLiteral({ ok: true })
  assertType<Equal<T.Denotes<typeof expression>, { ok: boolean }>>()
  assert.equal(T.assign(T.prop(T.hostValue<{ x: { ok: true } }>("obj"), "x"), expression).kind, "assign")
  assert.equal(T.call(T.hostValue<(v: { ok: true }) => number>("consume"), { ok: true }).kind, "call")
})

const invalidContextualValues = () => {
  const target = T.prop(T.hostValue<{ x: { ok: true } }>("obj"), "x")
  const consume = T.hostValue<(v: { ok: true }) => number>("consume")
  // @ts-expect-error a wrong literal does not satisfy the contextual target
  T.assign(target, { ok: false })
  // @ts-expect-error a wrong literal node does not satisfy the parameter
  T.call(consume, T.objectLiteral({ ok: false }))
  // @ts-expect-error fresh fallback must retain excess-property checking
  T.assign(target, { ok: true, extra: 1 })
  // @ts-expect-error recovering fresh fields must not admit an excess-property literal
  T.call(consume, T.objectLiteral({ ok: true, extra: 1 }))
  // @ts-expect-error fresh nested arrays must not hide excess object fields
  T.call(T.hostValue<(v: { ok: true }[]) => number>("consume"), T.arrayLiteral(T.objectLiteral({ ok: true, extra: 1 })))
  // @ts-expect-error fresh fields do not repair an argument's wrong primitive type
  T.call(T.hostValue<(v: number) => number>("consume"), T.stringLiteral("wrong"))
  // @ts-expect-error required argument counts remain enforced
  T.call(consume)
  // @ts-expect-error extra arguments remain forbidden
  T.call(consume, T.objectLiteral({ ok: true }), 1)
  T.build(function*() {
    const stored = yield* T.const("stored", T.objectLiteral({ ok: true }))
    // @ts-expect-error a stored boolean field is not a fresh true literal
    yield* T.assign(target, stored)
    // @ts-expect-error call targets cannot re-narrow a stored object's fields
    T.call(consume, stored)
    return stored
  })
}
void invalidContextualValues
