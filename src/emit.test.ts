import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "./$.ts"
import { makeEmit, type Target, traversal } from "./emit/index.ts"
import * as Expr from "./expr.ts"
import * as Program from "./program.ts"
import * as Type from "./types/index.ts"

test("an analysis is a traversal with overrides", () => {
  const program = Program.build(function*() {
    const double = yield* $.fun("double", [$.Param("x", Type.Number())], function*({ x }) {
      return $.mul(x, 2)
    })
    const answer = yield* $.Const("answer", double(21))
    return answer
  })

  const names: string[] = []
  const emit = makeEmit({
    ...traversal,
    expr: {
      ...traversal.expr,
      "var-ref": (node) => {
        names.push(node.name)
      },
    },
  })
  program.statements.forEach(emit.statement)

  assert.deepEqual(names, ["x"])
})

test("Template rejects mismatched parts and exprs at construction", () => {
  assert.throws(() => Expr.Template(["a"], Expr.Number(1)), /needs 2 parts, got 1/)
  assert.throws(() => Type.TemplateLiteral(["a", "b", "c"], Type.Literal(1)), /needs 2 parts, got 3/)
})

test("a target missing a handler fails to compile", () => {
  const { template: _dropped, ...withoutTemplate } = traversal.expr
  const incomplete = { ...traversal, expr: withoutTemplate }
  // @ts-expect-error every node kind requires a handler
  const target: Target<void, void, void> = incomplete
  void target
})
