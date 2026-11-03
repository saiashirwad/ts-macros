import assert from "node:assert/strict"
import { test } from "node:test"

import { emitTs, ts } from "../languages/typescript.ts"
import { typecheck } from "./stage2.ts"

test("nested native properties retain result evidence without recursive selection", () => {
  const strings = ts.hostValue("strings", ts.array(ts.string))
  assert.equal(ts.call(ts.get(ts.get(strings, 0), "trim")).type, ts.string)
  const text = ts.call(ts.get(ts.literal("hello"), "toString"))
  assert.equal(ts.call(ts.get(text, "trim")).type, ts.string)
  const symbolic = ts.call(ts.get(ts.literal("hello"), "repeat"), ts.literal(2))
  assert.equal(symbolic.type.kind, "call-result")
})

test("callable selection consumes nullish and predicate refinement evidence", () => {
  const program = ts.program(function*() {
    const callable = ts.functionType([], ts.number)
    const optional = yield* ts.let("optional", ts.hostValue("external", ts.union(callable, ts.null)))
    yield* ts.if(ts.notNull(optional), function*(present) {
      assert.equal(ts.call(present).type, ts.number)
      yield* ts.run(ts.call(present))
    })
    const mixed = yield* ts.let("mixed", ts.hostValue("mixedValue", ts.union(callable, ts.string)))
    const isString = ts.hostValue("isString", ts.functionType([ts.unknown], ts.predicate(0, ts.string)))
    yield* ts.if(ts.call(isString, mixed), function*() {}, function*(remaining) {
      assert.equal(ts.call(remaining).type, ts.number)
      yield* ts.run(ts.call(remaining))
    })
    const guard = ts.hostValue("guard", ts.functionType([ts.unknown], ts.predicate(0, ts.object({ get: callable }))))
    const input = yield* ts.let("input", ts.hostValue("inputValue", ts.unknown))
    yield* ts.if(ts.call(guard, input), function*(object) {
      assert.equal(ts.call(ts.get(object, "get")).type, ts.number)
      yield* ts.run(ts.call(ts.get(object, "get")))
    })
  })
  const source = emitTs(program)
  assert.equal(
    typecheck([`declare const external: (() => number) | null;
declare const inputValue: unknown;
declare const mixedValue: (() => number) | string;
declare const isString: (input: unknown) => input is string;
declare const guard: (input: unknown) => input is { get: () => number };
${source}`]),
    "",
  )
})
