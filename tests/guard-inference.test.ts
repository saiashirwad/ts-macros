import assert from "node:assert/strict"
import { test } from "node:test"
import * as Guard from "../src/guard.ts"
import * as $ from "../src/index.ts"
import { sameType } from "../src/types/algebra.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

interface TextRefinement extends Guard.Refinement {
  readonly output: Extract<this["input"], string>
  readonly check: []
  readonly negative: Exclude<this["input"], string>
  readonly negativeCheck: []
}

test("custom refinements compose without losing outputs or exact complements", () => {
  $.build(function*() {
    const subject = yield* $.let("subject", $.Union($.String, $.Number, $.Null))
    const native = $.isTypeof(subject, "string")
    const text: Guard.RefinedGuard<string, TextRefinement, string | number | null> = {
      subject,
      condition: $.eq($.typeof(subject), "string"),
      test: (value) => $.eq($.typeof(value), "string"),
      type: $.String,
      inputType: $.Union($.String, $.Number, $.Null),
      complement: $.Union($.Number, $.Null),
      refine: native.refine,
      reject: native.reject,
    }
    const combined = $.allOf($.allOf($.notNullish(subject), text), $.notNullish(subject))
    assertType<Equal<$.TypeDenotes<typeof combined.type>, string>>()
    assertType<Equal<Guard.Complement<typeof combined>, number | null>>()
    assertType<Equal<Guard.CheckComplement<typeof combined>, []>>()
    assert.ok(sameType(combined.type, $.String))
    assert.ok(sameType(combined.complement, $.Union($.Union($.Null, $.Number), $.Never)))
    yield* $.ifGuard(combined, function*(value) {
      assertType<Equal<$.Denotes<typeof value>, string>>()
    }).elseGuard(function*(value) {
      assertType<Equal<$.Denotes<typeof value>, number | null>>()
    })
    return null
  })
})

test("chained built-in refinements preserve readonly alternatives and unknown false flow", () => {
  $.build(function*() {
    const arrays = yield* $.let("arrays", $.Union($.ReadonlyArray($.Number), $.Array($.String), $.Null))
    const chain = $.allOf($.allOf($.notNullish(arrays), $.isArray(arrays)), $.notNullish(arrays))
    assertType<Equal<$.TypeDenotes<typeof chain.type>, readonly number[] | string[]>>()
    assertType<Equal<Guard.Complement<typeof chain>, readonly number[] | null>>()
    yield* $.ifGuard(chain, function*(value) {
      assertType<Equal<$.Denotes<typeof value>, readonly number[] | string[]>>()
      // @ts-expect-error readonly array alternatives cannot be mutated
      $.assign($.index(value, 0), 1)
    }).elseGuard(function*(value) {
      assertType<Equal<$.Denotes<typeof value>, readonly number[] | null>>()
    })
    const subject = yield* $.let("subject", $.Unknown)
    const object = $.allOf($.isTypeof(subject, "object"), $.notNullish(subject))
    assertType<Equal<$.TypeDenotes<typeof object.type>, object>>()
    assertType<Equal<Guard.Complement<typeof object>, unknown>>()
    assert.ok(sameType(object.complement, $.Unknown))
    yield* $.ifGuard(object, function*(value) {
      assertType<Equal<$.Denotes<typeof value>, object>>()
    }).elseGuard(function*(value) {
      assertType<Equal<$.Denotes<typeof value>, unknown>>()
    })
    return null
  })
})
