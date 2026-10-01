import assert from "node:assert/strict"
import { test } from "node:test"

import { Expr, FFI, Type } from "../src/index.ts"
import type { Equal } from "./typing.ts"

test("recursive lift checks terminate without rejecting finite recursive records", () => {
  type Tree = { value: number; children: Tree[] }
  const tree: Tree = { value: 1, children: [] }
  const exact: Equal<Expr.CheckLift<Tree>, []> = true
  assert.equal(exact, true)
  assert.equal(Expr.call(FFI.Value<(tree: Tree) => number>("count"), tree).kind, "call")
  type Left = { value: number; right?: Right }
  type Right = { value: string; left?: Left }
  const mutual: Equal<Expr.CheckLift<Left>, []> = true
  assert.equal(mutual, true)
  const left: Left = { value: 1 }
  assert.equal(Expr.call(FFI.Value<(left: Left) => number>("count"), left).kind, "call")
})

const recursiveFailure = () => {
  const bad = Expr.arrow({
    returns: Type.string,
    body: function*() {
      return 1
    },
  })
  type Poisoned = { value: number; children: Poisoned[]; bad: typeof bad }
  const poisoned: Poisoned = { value: 1, children: [], bad }
  // @ts-expect-error cycle handling must still visit the non-cyclic failed field
  Expr.call(FFI.Value<(tree: Poisoned) => number>("count"), poisoned)
  type Branch = { value: number; child?: Branch }
  type Extra = Branch & { bad: typeof bad }
  const extra: Extra = { value: 1, bad }
  // @ts-expect-error a structural subtype of a seen ancestor is not the same type
  Expr.call(FFI.Value<(tree: { parent: Branch; child: Extra }) => number>("count"), { parent: { value: 1 }, child: extra })
}
void recursiveFailure
