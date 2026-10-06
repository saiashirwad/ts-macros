import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { cases } from "./exactness.ts"
import { assertType, expectTypeOf } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("array reads include undefined without weakening array writes", () => {
  const read = T.index(T.arrayLiteral(1), 0)
  expectTypeOf<T.Denotes<typeof read>>().toEqualTypeOf<number | undefined>()
  assert.deepEqual(read.type, T.Union(T.Number, T.Undefined))
  T.build(function*() {
    const xs = yield* T.const("xs", [1])
    yield* T.assign(T.index(xs, 0), 2)
    // @ts-expect-error the read's undefined alternative is not a valid array element write
    T.assign(T.index(xs, 0), T.hostValue<undefined>("undefined"))
    return xs
  })
})

test("tuple reads keep known positions and include undefined for dynamic positions", () => {
  T.build(function*() {
    const tuple = yield* T.let("tuple", T.Tuple(T.Number, T.String))
    const first = T.index(tuple, 0)
    expectTypeOf<T.Denotes<typeof first>>().toEqualTypeOf<number>()
    assert.equal(first.type, T.Number)
    const dynamic = T.index(tuple, T.hostValue<number>("indexValue"))
    expectTypeOf<T.Denotes<typeof dynamic>>().toEqualTypeOf<number | string | undefined>()
    assert.deepEqual(dynamic.type, T.Union(T.Number, T.String, T.Undefined))
    // @ts-expect-error known tuple indices remain range-checked
    T.index(tuple, 2)
    // @ts-expect-error a dynamic read's undefined does not weaken writes
    T.assign(dynamic, T.hostValue<undefined>("undefined"))
    return tuple
  })
})

test("tuple reads and writes use the index's declared literal type", () => {
  assertType<Equal<T.Denotes<typeof cases.tupleBoundIndex.program.result>, (tuple: [number, string]) => number>>()
  const declaration = cases.tupleBoundIndex.program.statements[0] as T.BuiltFunction
  assert.equal(declaration.type?.return, T.Number)
  T.build(function*() {
    const tuple = yield* T.let("tuple", T.Tuple(T.Number, T.String))
    const zero = yield* T.const("zero", 0)
    yield* T.assign(T.index(tuple, zero), 1)
    // @ts-expect-error a literal-typed reference selects the number position for writes too
    T.assign(T.index(tuple, zero), "x")
    const outside = yield* T.const("outside", 2)
    // @ts-expect-error literal-typed references are range-checked
    T.index(tuple, outside)
    return tuple
  })
  const union = cases.tupleUnionIndex.program.statements[0] as T.BuiltFunction
  assert.deepEqual(union.type?.return, T.Union(T.Number, T.String))
})
