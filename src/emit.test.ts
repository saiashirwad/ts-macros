import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "./$.ts"
import { type Fragment, type Target, text } from "./emit/index.ts"
import * as Expr from "./expr.ts"
import * as Program from "./program.ts"
import * as Type from "./types/index.ts"
import { walk } from "./walk.ts"

test("an analysis is a structural walk", () => {
  const program = Program.build(function*() {
    const double = yield* $.fun("double", [$.Param("x", Type.Number())], function*({ x }) {
      return $.mul(x, 2)
    })
    const answer = yield* $.Const("answer", double(21))
    return answer
  })

  const names: string[] = []
  walk(program.statements, (node) => {
    if (node.tag === "var-ref") names.push((node as Expr.VarRef<any, any>).name)
  })

  // function refs are var-refs too, so the callee shows up
  assert.deepEqual(names, ["x", "double"])
})

test("Template rejects mismatched parts and exprs at construction", () => {
  assert.throws(() => Expr.Template(["a"], Expr.Number(1)), /needs 2 parts, got 1/)
  assert.throws(() => Type.TemplateLiteral(["a", "b", "c"], Type.Literal(1)), /needs 2 parts, got 3/)
})

test("a target missing a handler fails to compile", () => {
  const { template: _dropped, ...withoutTemplate } = text.expr
  const incomplete = { ...text, expr: withoutTemplate }
  // @ts-expect-error every node kind requires a handler
  const target: Target<Fragment, string, Fragment> = incomplete
  void target
})
