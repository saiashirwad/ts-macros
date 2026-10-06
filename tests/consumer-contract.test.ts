import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
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
  const id = T.hostValue<Id>("id")
  const tree = T.hostValue<Tree>("tree")
  const program = T.build(function*() {
    const savedId = yield* T.const("savedId", id)
    assertType<Equal<T.Denotes<typeof savedId>, Id>>()
    const savedTree = yield* T.const("savedTree", tree)
    assertType<Equal<T.Denotes<typeof savedTree>, Tree>>()
    const fresh = yield* T.const("fresh", "draft")
    assertType<Equal<T.Denotes<typeof fresh>, "draft">>()
    const takeId = T.hostValue<(value: Id) => number>("takeId")
    const takeTree = T.hostValue<(value: Tree) => number>("takeTree")
    const result = yield* T.const("result", T.add(T.call(takeId, savedId), T.call(takeTree, savedTree)))
    const status = yield* T.let("status", "draft", T.Union(T.Literal("draft"), T.Literal("done")))
    assertType<Equal<T.Denotes<typeof status>, "draft" | "done">>()
    yield* T.assign(status, "done")
    return result
  })
  assertType<Equal<T.Denotes<typeof program.result>, number>>()
})

const rejectedConsumerOperations = () => {
  const id = T.hostValue<Id>("id")
  const takeId = T.hostValue<(value: Id) => number>("takeId")
  const tree = T.hostValue<Tree>("tree")
  T.call(takeId, id)
  // @ts-expect-error a plain string cannot satisfy a branded identifier
  T.call(takeId, "id")
  // @ts-expect-error unknown is not evidence of a branded identifier
  T.call(takeId, T.hostValue<unknown>("untrusted"))
  T.call(T.hostValue<(value: Tree) => number>("takeTree"), tree)
  // @ts-expect-error a recursive node must contain children of the same shape
  T.call(T.hostValue<(value: Tree) => number>("takeTree"), { value: 1, children: [{ value: "bad", children: [] }] })
  T.build(function*() {
    const status = yield* T.let("status", "draft", T.Union(T.Literal("draft"), T.Literal("done")))
    yield* T.assign(status, "done")
    // @ts-expect-error a third state is not a valid assignment
    yield* T.assign(status, "deleted")
    const inferred = yield* T.const("inferred", "draft")
    const acceptsDraft = T.hostValue<(value: "draft") => void>("acceptsDraft")
    T.call(acceptsDraft, inferred)
    // @ts-expect-error the literal must not widen to arbitrary strings at the call site
    T.call(acceptsDraft, "done")
    return status
  })
}
void rejectedConsumerOperations

test("consumer denotations agree with unchanged emitted TypeScript", () => {
  assert.equal(emittedTypecheck(new URL("./consumer-emission.ts", import.meta.url), cases), "")
})
