import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"
import { typeOf } from "./typing.ts"

test("returned object shapes include missing optional properties", () => {
  const program = Program.build(function*() {
    const choose = yield* Decl.fn("choose", {
      params: [Expr.param("b", Type.boolean)],
      body: function*({ b }) {
        yield* Stmt.if_(b, function*() {
          yield* Stmt.return_({ a: 1 })
        })
        return { b: 2 }
      },
    })
    typeOf(choose).is<(b: boolean) => { a: number; b?: never } | { a?: never; b: number }>()
    return choose
  })
  const declaration = program.statements[0] as Decl.BuiltFunction
  const returned = declaration.type?.return as Type.Union
  assert.deepEqual((returned.members[0] as Type.Object).fields.b, Type.optional(Type.never))
  assert.deepEqual((returned.members[1] as Type.Object).fields.a, Type.optional(Type.never))
})
