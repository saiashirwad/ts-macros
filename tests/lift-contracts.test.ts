import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import type { FailedCheck } from "../src/node.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("diagnostic and structural lift checks accept recursive and optional records", () => {
  type Tree = { value: number; children: Tree[] }
  type Branch = { value: number; child?: Branch }
  type Optional = { value?: number }
  assertType<Equal<[$.CheckLift<Tree>, $.CheckLiftable<Tree>], [[], []]>>()
  assertType<Equal<[$.CheckLift<Branch>, $.CheckLiftable<Branch>], [[], []]>>()
  assertType<Equal<[$.CheckLift<Optional>, $.CheckLiftable<Optional>], [[], []]>>()
  assertType<Equal<[$.CheckLift<any>, $.CheckLiftable<any>], [[], []]>>()
  const tree: Tree = { value: 1, children: [] }
  const branch: Branch = { value: 2 }
  assert.equal($.lift(tree).kind, "object")
  assert.equal($.lift(branch).kind, "object")
})

test("diagnostic lift checks locate erased fields while acceptance rejects the whole input", () => {
  type Tree = { value: object; children: Tree[] }
  type Optional = { value?: object }
  assertType<Equal<$.CheckLift<Tree>, ["cannot lift a value typed", object]>>()
  assertType<Equal<$.CheckLiftable<Tree>, ["cannot lift", Tree]>>()
  assertType<Equal<$.CheckLift<Optional>, ["cannot lift a value typed", object]>>()
  assertType<Equal<$.CheckLiftable<Optional>, ["cannot lift", Optional]>>()
  assertType<Equal<$.CheckLift<object>, ["cannot lift a value typed", object]>>()
  assertType<Equal<$.CheckLiftable<object>, ["cannot lift", object]>>()
  assertType<Equal<$.CheckLift<{}>, ["cannot lift a value typed", {}]>>()
  assertType<Equal<$.CheckLiftable<{}>, ["cannot lift", {}]>>()
  type Fn = () => number
  assertType<Equal<$.Value<Fn>, Fn>>()
  assertType<Equal<[$.CheckLift<Fn>, $.CheckLiftable<Fn>], [["cannot lift", Fn], ["cannot lift", Fn]]>>()
})

test("both lift checks reject a poisoned union", () => {
  type Poison = Exclude<FailedCheck<["invalid"]>, undefined>
  type Choice = { value: number } | { value: Poison }
  assertType<Equal<$.CheckLift<Choice>, ["cannot lift", Poison]>>()
  assertType<Equal<$.CheckLiftable<Choice>, ["cannot lift", Choice]>>()
})

test("conditional targets recover fresh fields without changing contextual denotations", () => {
  const literal = $.object({ ok: true })
  const choice = $.cond(true, literal, literal)
  assertType<Equal<$.Denotes<typeof literal>, { ok: boolean }>>()
  assertType<Equal<$.ContextualValue<typeof literal>, { ok: true }>>()
  assertType<Equal<$.Denotes<typeof choice>, { ok: boolean }>>()
  assertType<Equal<$.ContextualValue<typeof choice>, { ok: boolean }>>()
  const consume = $.hostValue<(value: { ok: true }) => number>("consume")
  const target = $.prop($.hostValue<{ value: { ok: true } }>("target"), "value")
  assert.equal($.call(consume, choice).kind, "call")
  assert.equal($.assign(target, choice).kind, "assign")
  $.build(function*() {
    const stored = yield* $.const("stored", choice)
    assertType<Equal<$.ContextualValue<typeof stored>, { ok: boolean }>>()
    // @ts-expect-error stored refs cannot recover conditional branch freshness
    $.call(consume, stored)
    // @ts-expect-error stored refs cannot recover conditional branch freshness
    $.assign(target, stored)
    return stored
  })
})
