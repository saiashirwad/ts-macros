import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import type { Abstract, Equal, Generic, Generics } from "../src/types/core.ts"
import { emitProgram } from "../targets/ts.ts"
import { assertType } from "./typing.ts"

type ExpectedPromise<A> = Abstract<[A]> extends true ? Generic<"Promise", [A]> : Generics<[A]>["Promise"]
type PromiseChecks<Cases extends unknown[]> = {
  [K in keyof Cases]: Equal<$.TypeDenotes<ReturnType<typeof $.Promise<$.Type<Cases[K]>>>>, ExpectedPromise<Cases[K]>>
}

test("Promise denotations reduce concrete arguments and retain symbolic arguments", () => {
  type Cases = [
    number,
    string | undefined,
    any,
    never,
    unknown,
    $.Variable<"T">,
    $.Variable<"T"> & number,
    $.Inferred<"U">,
    Promise<number>,
    Promise<$.Variable<"T">>,
    Generic<"Promise", [$.Variable<"T">]>,
    { value: $.Variable<"T"> },
    $.Op<"keyof", [$.Variable<"T">]>,
    [unknown, $.Variable<"T">],
    (value: $.Variable<"T">) => number,
    $.Variable<"T"> | boolean,
  ]
  assertType<Equal<PromiseChecks<Cases>[number], true>>()
})

test("Promise metadata, alias application, and infer patterns preserve their arguments", () => {
  const T = $.TypeParam("T")
  const symbolic = $.Promise(T)
  assert.equal(symbolic.kind, "external")
  assert.equal(symbolic.name, "Promise")
  assert.deepEqual(symbolic.args, [T])

  const program = $.build(function*() {
    const Wrap = yield* $.type("Wrap", { params: [T], body: symbolic })
    const wrapped = $.Apply(Wrap, [$.Number])
    assertType<Equal<$.TypeDenotes<typeof wrapped>, Promise<number>>>()
    yield* $.type("Wrapped", wrapped)
    const nested = $.Promise($.Promise($.Number))
    assertType<Equal<$.TypeDenotes<typeof nested>, Promise<Promise<number>>>>()
    yield* $.type("Nested", nested)
    const Unwrap = yield* $.type("Unwrap", {
      params: [T],
      body: $.Conditional(T, $.Promise($.Infer("U")), $.TypeParam("U"), T),
    })
    const unwrapped = $.Apply(Unwrap, [nested])
    assertType<Equal<$.TypeDenotes<typeof unwrapped>, Promise<number>>>()
    return yield* $.type("Unwrapped", unwrapped)
  })
  assert.equal(
    emitProgram(program),
    "type Wrap<T> = Promise<T>;\ntype Wrapped = Wrap<number>;\ntype Nested = Promise<Promise<number>>;\ntype Unwrap<T> = T extends Promise<infer U> ? U : T;\ntype Unwrapped = Unwrap<Promise<Promise<number>>>;",
  )
})
