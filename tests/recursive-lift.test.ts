import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("recursive lift checks terminate without rejecting finite recursive records", () => {
  type Tree = { value: number; children: Tree[] }
  const tree: Tree = { value: 1, children: [] }
  assertType<Equal<$.CheckLift<Tree>, []>>()
  assert.equal($.lift(tree).kind, "object")
  assert.equal($.call($.hostValue<(tree: Tree) => number>("count"), tree).kind, "call")
  type Left = { value: number; right?: Right }
  type Right = { value: string; left?: Left }
  assertType<Equal<$.CheckLift<Left>, []>>()
  const left: Left = { value: 1 }
  assert.equal($.lift(left).kind, "object")
  assert.equal($.call($.hostValue<(left: Left) => number>("count"), left).kind, "call")
})

const recursiveFailure = () => {
  const bad = $.arrow({
    returns: $.String,
    body: function*() {
      return 1
    },
  })
  type Poisoned = { value: number; children: Poisoned[]; bad: typeof bad }
  const poisoned: Poisoned = { value: 1, children: [], bad }
  // @ts-expect-error cycle handling must still visit the non-cyclic failed field
  $.call($.hostValue<(tree: Poisoned) => number>("count"), poisoned)
  // @ts-expect-error directly lifting a recursive record must visit its failed field
  $.lift(poisoned)
  type Branch = { value: number; child?: Branch }
  type Extra = Branch & { bad: typeof bad }
  const extra: Extra = { value: 1, bad }
  // @ts-expect-error a structural subtype of a seen ancestor is not the same type
  $.call($.hostValue<(tree: { parent: Branch; child: Extra }) => number>("count"), { parent: { value: 1 }, child: extra })
  const mixed: Branch | Extra = Math.random() < 0.5 ? { value: 1 } : extra
  // @ts-expect-error a valid union member cannot hide a poisoned extra field
  $.lift({ mixed })
  // @ts-expect-error the object constructor must reject the same poisoned union
  $.object({ mixed })
  const item: $.Expr<object> | object = Math.random() < 0.5 ? $.object({ value: 1 }) : { value: 1 }
  // @ts-expect-error an expression alternative cannot legalize an erased object type
  $.lift({ item })
}
void recursiveFailure
