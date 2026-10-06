import assert from "node:assert/strict"
import { test } from "node:test"
import type { FailedCheck } from "../src/node.ts"

import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { expectTypeOf } from "./typing.ts"

test("arrow infers a parameter-dependent body without casts", () => {
  const grade = $.arrow({
    params: [$.param("b", $.Boolean)],
    body: function*({ b }) {
      yield* $.if(b, function*() {
        yield* $.return("A")
      })
      return "B"
    },
  })
  expectTypeOf<$.Denotes<typeof grade>>().toEqualTypeOf<(b: boolean) => "A" | "B">()
  const single = $.arrow({
    body: function*() {
      return "A"
    },
  })
  expectTypeOf<$.Denotes<typeof single>>().toEqualTypeOf<() => string>()
  const program = $.build(function*() {
    return yield* $.const("grade", grade)
  })
  assert.equal(emitProgram(program), "const grade = (b: boolean) => {\n  if (b) {\n    return \"A\";\n  }\n  return \"B\";\n};")
})

test("arrows honor the function spec's return annotation and type parameters", () => {
  const T = $.TypeParam("T")
  const identity = $.arrow({
    typeParams: [T],
    params: [$.param("value", T)],
    returns: T,
    body: function*({ value }) {
      return value
    },
  })
  const program = $.build(function*() {
    const result = yield* $.const("result", $.call($.instantiate(identity, $.Number), 1))
    expectTypeOf<$.Denotes<typeof result>>().toEqualTypeOf<number>()
    return result
  })
  assert.equal(
    emitProgram(program),
    "const result = (<T>(value: T): T => {\n  return value;\n})<number>(1);",
  )
})

const invalidArrows = () => {
  const badLift = $.arrow({
    body: function*() {
      return () => 1
    },
  })
  expectTypeOf<typeof badLift>().toEqualTypeOf<FailedCheck<["cannot lift", () => 1]>>()
  // @ts-expect-error an error result cannot initialize a binding
  $.const("bad", badLift)
  // @ts-expect-error an error result cannot be called
  $.call(badLift)
  const badFinal = $.arrow({
    returns: $.Number,
    body: function*() {
      return "A"
    },
  })
  expectTypeOf<typeof badFinal>().toEqualTypeOf<FailedCheck<["the returned value", "A", "is not assignable to", number]>>()
  const badEarly = $.arrow({
    returns: $.Number,
    body: function*() {
      yield* $.return("A")
      return 1
    },
  })
  expectTypeOf<typeof badEarly>().toEqualTypeOf<FailedCheck<["early returns", "A", "do not satisfy the declared return type", number]>>()
  // @ts-expect-error an error result cannot be returned as an expression
  $.return(badFinal)
  // @ts-expect-error required parameters cannot follow optional ones
  $.arrow({
    params: [$.optional("x", $.Number), $.param("y", $.Number)],
    body: function*() {
      return 1
    },
  })
  // @ts-expect-error duplicate type parameter names
  $.arrow({
    typeParams: [$.TypeParam("T"), $.TypeParam("T")],
    body: function*() {
      return 1
    },
  })
}
void invalidArrows
