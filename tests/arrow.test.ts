import assert from "node:assert/strict"
import { test } from "node:test"
import type { FailedCheck } from "../src/node.ts"

import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { expectTypeOf } from "./typing.ts"

test("arrow infers a parameter-dependent body without casts", () => {
  const grade = T.arrow({
    params: [T.param("b", T.Boolean)],
    body: function*({ b }) {
      yield* T.if(b, function*() {
        yield* T.return("A")
      })
      return "B"
    },
  })
  expectTypeOf<T.Denotes<typeof grade>>().toEqualTypeOf<(b: boolean) => "A" | "B">()
  const single = T.arrow({
    body: function*() {
      return "A"
    },
  })
  expectTypeOf<T.Denotes<typeof single>>().toEqualTypeOf<() => string>()
  const program = T.build(function*() {
    return yield* T.const("grade", grade)
  })
  assert.equal(emitProgram(program), "const grade = (b: boolean) => {\n  if (b) {\n    return \"A\";\n  }\n  return \"B\";\n};")
})

test("arrows honor the function spec's return annotation and type parameters", () => {
  const TParam = T.TypeParam("T")
  const identity = T.arrow({
    typeParams: [TParam],
    params: [T.param("value", TParam)],
    returns: TParam,
    body: function*({ value }) {
      return value
    },
  })
  const program = T.build(function*() {
    const result = yield* T.const("result", T.call(T.instantiate(identity, T.Number), 1))
    expectTypeOf<T.Denotes<typeof result>>().toEqualTypeOf<number>()
    return result
  })
  assert.equal(
    emitProgram(program),
    "const result = (<T>(value: T): T => {\n  return value;\n})<number>(1);",
  )
})

const invalidArrows = () => {
  const badLift = T.arrow({
    body: function*() {
      return () => 1
    },
  })
  expectTypeOf<typeof badLift>().toEqualTypeOf<FailedCheck<["cannot lift", () => 1]>>()
  // @ts-expect-error an error result cannot initialize a binding
  T.const("bad", badLift)
  // @ts-expect-error an error result cannot be called
  T.call(badLift)
  const badFinal = T.arrow({
    returns: T.Number,
    body: function*() {
      return "A"
    },
  })
  expectTypeOf<typeof badFinal>().toEqualTypeOf<FailedCheck<["the returned value", "A", "is not assignable to", number]>>()
  const badEarly = T.arrow({
    returns: T.Number,
    body: function*() {
      yield* T.return("A")
      return 1
    },
  })
  expectTypeOf<typeof badEarly>().toEqualTypeOf<FailedCheck<["early returns", "A", "do not satisfy the declared return type", number]>>()
  // @ts-expect-error an error result cannot be returned as an expression
  T.return(badFinal)
  // @ts-expect-error required parameters cannot follow optional ones
  T.arrow({
    params: [T.optional("x", T.Number), T.param("y", T.Number)],
    body: function*() {
      return 1
    },
  })
  // @ts-expect-error duplicate type parameter names
  T.arrow({
    typeParams: [T.TypeParam("T"), T.TypeParam("T")],
    body: function*() {
      return 1
    },
  })
}
void invalidArrows
