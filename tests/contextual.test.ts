import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Stmt } from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { cases } from "./exactness.ts"
import type { Equal } from "./typing.ts"

test("assignment and call targets see fresh object fields before widening", () => {
  assert.equal(emitProgram(cases.assignLiteralObject.program), "obj.x = { ok: true };\nconst actual = 1;")
  assert.equal(emitProgram(cases.callLiteralObject.program), "const actual = consume({ ok: true });")
  const expression = Expr.object({ ok: true })
  const inferred: Equal<Expr.Denotes<typeof expression>, { ok: boolean }> = true
  assert.equal(inferred, true)
  assert.equal(Stmt.assign(Expr.prop(FFI.Value<{ x: { ok: true } }>("obj"), "x"), expression).kind, "assign")
  assert.equal(Expr.call(FFI.Value<(v: { ok: true }) => number>("consume"), { ok: true }).kind, "call")
})

const invalidContextualValues = () => {
  const target = Expr.prop(FFI.Value<{ x: { ok: true } }>("obj"), "x")
  const consume = FFI.Value<(v: { ok: true }) => number>("consume")
  // @ts-expect-error a wrong literal does not satisfy the contextual target
  Stmt.assign(target, { ok: false })
  // @ts-expect-error a wrong literal node does not satisfy the parameter
  Expr.call(consume, Expr.object({ ok: false }))
  // @ts-expect-error fresh fallback must retain excess-property checking
  Stmt.assign(target, { ok: true, extra: 1 })
  // @ts-expect-error recovering fresh fields must not admit an excess-property literal
  Expr.call(consume, Expr.object({ ok: true, extra: 1 }))
  // @ts-expect-error fresh nested arrays must not hide excess object fields
  Expr.call(FFI.Value<(v: { ok: true }[]) => number>("consume"), Expr.array(Expr.object({ ok: true, extra: 1 })))
  // @ts-expect-error fresh fields do not repair an argument's wrong primitive type
  Expr.call(FFI.Value<(v: number) => number>("consume"), Expr.string("wrong"))
  // @ts-expect-error required argument counts remain enforced
  Expr.call(consume)
  // @ts-expect-error extra arguments remain forbidden
  Expr.call(consume, Expr.object({ ok: true }), 1)
  Program.build(function*() {
    const stored = yield* Decl.const_("stored", Expr.object({ ok: true }))
    // @ts-expect-error a stored boolean field is not a fresh true literal
    yield* Stmt.assign(target, stored)
    // @ts-expect-error call targets cannot re-narrow a stored object's fields
    Expr.call(consume, stored)
    return stored
  })
}
void invalidContextualValues
