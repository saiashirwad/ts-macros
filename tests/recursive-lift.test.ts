import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("recursive lift checks terminate without rejecting finite recursive records", () => {
  type Tree = { value: number; children: Tree[] }
  const tree: Tree = { value: 1, children: [] }
  assertType<Equal<T.CheckLift<Tree>, []>>()
  assert.equal(T.lift(tree).kind, "object")
  assert.equal(T.call(T.hostValue<(tree: Tree) => number>("count"), tree).kind, "call")
  type Left = { value: number; right?: Right }
  type Right = { value: string; left?: Left }
  assertType<Equal<T.CheckLift<Left>, []>>()
  const left: Left = { value: 1 }
  assert.equal(T.lift(left).kind, "object")
  assert.equal(T.call(T.hostValue<(left: Left) => number>("count"), left).kind, "call")
})

const recursiveFailure = () => {
  const bad = T.arrow({
    returns: T.String,
    body: function*() {
      return 1
    },
  })
  type Poisoned = { value: number; children: Poisoned[]; bad: typeof bad }
  const poisoned: Poisoned = { value: 1, children: [], bad }
  // @ts-expect-error cycle handling must still visit the non-cyclic failed field
  T.call(T.hostValue<(tree: Poisoned) => number>("count"), poisoned)
  // @ts-expect-error directly lifting a recursive record must visit its failed field
  T.lift(poisoned)
  type Branch = { value: number; child?: Branch }
  type Extra = Branch & { bad: typeof bad }
  const extra: Extra = { value: 1, bad }
  // @ts-expect-error a structural subtype of a seen ancestor is not the same type
  T.call(T.hostValue<(tree: { parent: Branch; child: Extra }) => number>("count"), { parent: { value: 1 }, child: extra })
  const mixed: Branch | Extra = Math.random() < 0.5 ? { value: 1 } : extra
  // @ts-expect-error a valid union member cannot hide a poisoned extra field
  T.lift({ mixed })
  // @ts-expect-error the object constructor must reject the same poisoned union
  T.objectLiteral({ mixed })
  const item: T.Expr<object> | object = Math.random() < 0.5 ? T.objectLiteral({ value: 1 }) : { value: 1 }
  // @ts-expect-error an expression alternative cannot legalize an erased object type
  T.lift({ item })
}
void recursiveFailure
