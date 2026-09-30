import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

const literalValue = (type: Type.Type<any> | undefined): string | number | boolean | null =>
  (type as Type.Any | undefined)?.kind === "literal" ? (type as Type.Literal).value : null

test("shadowed bindings keep distinct identities and types", () => {
  let outer!: Expr.Ref<number, any, any>
  let inner!: Expr.Ref<string, any, any>
  Program.build(function*() {
    outer = yield* Decl.const_("value", Expr.number(1))
    yield* Stmt.if_(Expr.boolean(true), function*() {
      inner = yield* Decl.const_("value", Expr.string("inner"))
      yield* Stmt.do_(Expr.call(FFI.Value<any>("use"), outer, inner))
    })
    return outer
  })

  assert.notEqual(outer.id, inner.id)
  assert.equal(literalValue(outer.type), 1)
  assert.equal(literalValue(inner.type), "inner")
})

test("local bindings are freshened around imported names", () => {
  const imported = FFI.Import<{ readonly read: () => string }>("files", "files")
  const program = Program.build(function*() {
    const local = yield* Decl.const_("files", Expr.number(1))
    yield* Stmt.do_(Expr.call(Expr.prop(imported, "read")))
    return local
  })

  const expected = `import * as files from "files";\nconst files_2 = 1;\nfiles.read();`
  assert.equal(emitProgram(program), expected)
})
