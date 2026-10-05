import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"
import { cases } from "./exactness.ts"
import { assertType, typeOf } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("returned object shapes include missing optional properties", () => {
  const program = Program.build(function*() {
    const choose = yield* Decl.fn("choose", {
      params: [Expr.param("b", Type.boolean)],
      body: function*({ b }) {
        yield* Stmt.if(b, function*() {
          yield* Stmt.return({ a: 1 })
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

test("non-fresh object references do not supply normalization keys", () => {
  assertType<Equal<Expr.Denotes<typeof cases.mixedObjectReturns.program.result>, (b: boolean, a: { a: number }) => { a: number } | { b: number }>>()
  const declaration = cases.mixedObjectReturns.program.statements[0] as Decl.BuiltFunction
  const returned = declaration.type?.return as Type.Union
  assert.deepEqual(Object.keys((returned.members[0] as Type.Object).fields), ["a"])
  assert.deepEqual(Object.keys((returned.members[1] as Type.Object).fields), ["b"])
})

test("conditional object unions normalize before being stored in bindings", () => {
  assertType<
    Equal<
      Expr.Denotes<typeof cases.objectConditionalBinding.program.result>,
      (b: boolean) => { a: number; b?: never } | { a?: never; b: number }
    >
  >()
  const declaration = cases.objectConditionalBinding.program.statements[0] as Decl.BuiltFunction
  const returned = declaration.type?.return as Type.Union
  const binding = declaration.body.statements[0] as Decl.BindingDeclaration
  assert.deepEqual(binding.type, returned)
  assert.deepEqual((returned.members[0] as Type.Object).fields.b, Type.optional(Type.never))
  assert.deepEqual((returned.members[1] as Type.Object).fields.a, Type.optional(Type.never))
  const array = cases.objectArrayUnion.program.statements[0] as Decl.BindingDeclaration
  assert.deepEqual((array.type as Type.ArrayType).element, returned)
})
