import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { cases } from "./consumer-emission.ts"
import { assertType, emittedTypecheck } from "./typing.ts"
import type { Equal } from "./typing.ts"

assertType<Equal<Equal<any, number>, false>>()
assertType<Equal<Equal<never, unknown>, false>>()
assertType<Equal<Equal<unknown, number>, false>>()
assertType<Equal<Equal<"draft", string>, false>>()
assertType<Equal<Equal<"draft" | "done", "draft">, false>>()

type Id = string & { readonly __brand: "Id" }
type Tree = { value: number; children: Tree[] }

test("consumer operations keep declared, branded and recursive denotations usable", () => {
  const id = $.hostValue<Id>("id")
  const tree = $.hostValue<Tree>("tree")
  const program = $.build(function*() {
    const savedId = yield* $.const("savedId", id)
    assertType<Equal<$.Denotes<typeof savedId>, Id>>()
    const savedTree = yield* $.const("savedTree", tree)
    assertType<Equal<$.Denotes<typeof savedTree>, Tree>>()
    const fresh = yield* $.const("fresh", "draft")
    assertType<Equal<$.Denotes<typeof fresh>, "draft">>()
    const takeId = $.hostValue<(value: Id) => number>("takeId")
    const takeTree = $.hostValue<(value: Tree) => number>("takeTree")
    const result = yield* $.const("result", $.add($.call(takeId, savedId), $.call(takeTree, savedTree)))
    const status = yield* $.let("status", "draft", $.Union($.Literal("draft"), $.Literal("done")))
    assertType<Equal<$.Denotes<typeof status>, "draft" | "done">>()
    yield* $.assign(status, "done")
    return result
  })
  assertType<Equal<$.Denotes<typeof program.result>, number>>()
})

const rejectedConsumerOperations = () => {
  const id = $.hostValue<Id>("id")
  const takeId = $.hostValue<(value: Id) => number>("takeId")
  const tree = $.hostValue<Tree>("tree")
  $.call(takeId, id)
  // @ts-expect-error a plain string cannot satisfy a branded identifier
  $.call(takeId, "id")
  // @ts-expect-error unknown is not evidence of a branded identifier
  $.call(takeId, $.hostValue<unknown>("untrusted"))
  $.call($.hostValue<(value: Tree) => number>("takeTree"), tree)
  // @ts-expect-error a recursive node must contain children of the same shape
  $.call($.hostValue<(value: Tree) => number>("takeTree"), { value: 1, children: [{ value: "bad", children: [] }] })
  $.build(function*() {
    const status = yield* $.let("status", "draft", $.Union($.Literal("draft"), $.Literal("done")))
    yield* $.assign(status, "done")
    // @ts-expect-error a third state is not a valid assignment
    yield* $.assign(status, "deleted")
    const inferred = yield* $.const("inferred", "draft")
    const acceptsDraft = $.hostValue<(value: "draft") => void>("acceptsDraft")
    $.call(acceptsDraft, inferred)
    // @ts-expect-error the literal must not widen to arbitrary strings at the call site
    $.call(acceptsDraft, "done")
    return status
  })
}
void rejectedConsumerOperations

test("consumer denotations agree with unchanged emitted TypeScript", () => {
  assert.equal(emittedTypecheck(new URL("./consumer-emission.ts", import.meta.url), cases), "")
})
