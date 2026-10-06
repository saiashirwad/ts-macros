import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { cases } from "./exactness.ts"
import { assertType, expectTypeOf } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("array reads include undefined without weakening array writes", () => {
  const read = $.index($.array(1), 0)
  expectTypeOf<$.Denotes<typeof read>>().toEqualTypeOf<number | undefined>()
  assert.deepEqual(read.type, $.Union($.Number, $.Undefined))
  $.build(function*() {
    const xs = yield* $.const("xs", [1])
    yield* $.assign($.index(xs, 0), 2)
    // @ts-expect-error the read's undefined alternative is not a valid array element write
    $.assign($.index(xs, 0), $.hostValue<undefined>("undefined"))
    return xs
  })
})

test("tuple reads keep known positions and include undefined for dynamic positions", () => {
  $.build(function*() {
    const tuple = yield* $.let("tuple", $.Tuple($.Number, $.String))
    const first = $.index(tuple, 0)
    expectTypeOf<$.Denotes<typeof first>>().toEqualTypeOf<number>()
    assert.equal(first.type, $.Number)
    const dynamic = $.index(tuple, $.hostValue<number>("indexValue"))
    expectTypeOf<$.Denotes<typeof dynamic>>().toEqualTypeOf<number | string | undefined>()
    assert.deepEqual(dynamic.type, $.Union($.Number, $.String, $.Undefined))
    // @ts-expect-error known tuple indices remain range-checked
    $.index(tuple, 2)
    // @ts-expect-error a dynamic read's undefined does not weaken writes
    $.assign(dynamic, $.hostValue<undefined>("undefined"))
    return tuple
  })
})

test("tuple reads and writes use the index's declared literal type", () => {
  assertType<Equal<$.Denotes<typeof cases.tupleBoundIndex.program.result>, (tuple: [number, string]) => number>>()
  const declaration = cases.tupleBoundIndex.program.statements[0] as $.BuiltFunction
  assert.equal(declaration.type?.return, $.Number)
  $.build(function*() {
    const tuple = yield* $.let("tuple", $.Tuple($.Number, $.String))
    const zero = yield* $.const("zero", 0)
    yield* $.assign($.index(tuple, zero), 1)
    // @ts-expect-error a literal-typed reference selects the number position for writes too
    $.assign($.index(tuple, zero), "x")
    const outside = yield* $.const("outside", 2)
    // @ts-expect-error literal-typed references are range-checked
    $.index(tuple, outside)
    return tuple
  })
  const union = cases.tupleUnionIndex.program.statements[0] as $.BuiltFunction
  assert.deepEqual(union.type?.return, $.Union($.Number, $.String))
})
