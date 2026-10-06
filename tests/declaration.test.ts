import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { expectTypeOf } from "./typing.ts"

test("binding declarations and references agree on annotations, widening, and freshness", () => {
  const annotation = $.Union($.Number, $.String)
  const builders = {
    uninitialized: $.let("uninitialized", $.Number),
    mutable: $.let("mutable", 1),
    literal: $.const("literal", 1),
    annotatedLet: $.let("annotatedLet", 1, annotation),
    annotatedConst: $.const("annotatedConst", 1, annotation),
  }
  const cases = [
    { builder: builders.uninitialized, type: $.Number, mutable: true, fresh: false },
    { builder: builders.mutable, type: $.Number, mutable: true, fresh: false },
    { builder: builders.literal, type: $.Literal(1), mutable: false, fresh: true },
    { builder: builders.annotatedLet, type: annotation, mutable: true, fresh: false },
    { builder: builders.annotatedConst, type: annotation, mutable: false, fresh: false },
  ]

  for (const { builder, type, mutable, fresh } of cases) {
    assert.deepEqual(builder.declaration.type, type)
    const iterator = builder[Symbol.iterator]()
    const yielded = iterator.next()
    assert.equal(yielded.done, false)
    assert.deepEqual(yielded.value, builder.declaration)
    const returned = iterator.next()
    assert.ok(returned.done)
    assert.deepEqual(returned.value.type, type)
    assert.equal(returned.value.id, builder.declaration.id)
    assert.equal(returned.value.mutable, mutable)
    assert.equal(returned.value.fresh, fresh)
  }

  const program = $.build(function*() {
    const uninitialized = yield* builders.uninitialized
    const mutable = yield* builders.mutable
    const literal = yield* builders.literal
    const annotatedLet = yield* builders.annotatedLet
    const annotatedConst = yield* builders.annotatedConst
    expectTypeOf<$.Denotes<typeof uninitialized>>().toEqualTypeOf<number>()
    expectTypeOf<$.Denotes<typeof mutable>>().toEqualTypeOf<number>()
    expectTypeOf<$.Denotes<typeof literal>>().toEqualTypeOf<1>()
    expectTypeOf<$.Denotes<typeof annotatedLet>>().toEqualTypeOf<number | string>()
    expectTypeOf<$.Denotes<typeof annotatedConst>>().toEqualTypeOf<number | string>()
    return literal
  })
  assert.equal(
    emitProgram(program),
    "let uninitialized: number;\nlet mutable = 1;\nconst literal = 1;\nlet annotatedLet: number | string = 1;\nconst annotatedConst: number | string = 1;",
  )
})

test("type alias bodies are resolved once at construction and keep parameter identities", () => {
  const T = $.TypeParam("T", $.String)
  let runs = 0
  const alias = $.type("Box", {
    params: [T],
    body: (params) => {
      runs++
      assert.equal(params.T, T)
      return $.Object({ value: params.T })
    },
  })
  assert.equal(runs, 1)

  const program = $.build(function*() {
    yield* $.type("Count", $.Number)
    yield* $.type("Named", { params: [T], body: T })
    return yield* alias
  })
  expectTypeOf<$.TypeDenotes<typeof program.result>>().toEqualTypeOf<$.Declared<[typeof T], { value: $.Variable<"T"> & string }>>()
  assert.equal(runs, 1)
  assert.equal(emitProgram(program), "type Count = number;\ntype Named<T extends string> = T;\ntype Box<T extends string> = { value: T };")
})

test("type alias callbacks reject non-type results at construction", () => {
  assert.throws(
    () => {
      // @ts-expect-error an alias callback must return a type node
      $.type("Broken", { params: [], body: () => 1 })
    },
    { message: "type \"Broken\" body must return a type" },
  )
})
