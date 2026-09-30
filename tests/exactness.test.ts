import assert from "node:assert/strict"
import { test } from "node:test"
import { Decl, Type } from "../src/index.ts"

import { cases, emptyArray, rawObject } from "./exactness.ts"
import { emittedTypecheck } from "./typing.ts"

test("denotations equal unchanged stage-2 inference, with recorded divergences", () => {
  const diagnostics = emittedTypecheck(new URL("./exactness.ts", import.meta.url), cases)
  assert.equal(diagnostics, "", diagnostics)
})

test("empty arrays attach their never-element runtime type", () => {
  assert.deepEqual(emptyArray.type, Type.array(Type.never))
  const declaration = cases.emptyReturn.program.statements[0] as Decl.BuiltFunction
  assert.deepEqual(declaration.type?.return, Type.array(Type.never))
  const field = cases.emptyField.program.statements[0] as Decl.BindingDeclaration
  assert.deepEqual((field.type as Type.Object).fields.values, Type.array(Type.never))
})

test("raw object fields widen as mutable locations", () => {
  assert.deepEqual(rawObject.type?.fields.a, { kind: "primitive", name: "number" })
})
