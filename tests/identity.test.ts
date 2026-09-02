import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram as emitProgramBabel } from "../targets/babel/index.ts"
import { emitProgramTypeScript } from "../targets/typescript/index.ts"

const literalValue = (type: Type.TypeExpr<any> | undefined): string | number | boolean | null =>
  (type as Type.Any | undefined)?.tag === "literal" ? (type as Type.Literal).value : null

test("shadowed bindings keep distinct identities and types", () => {
  let outer!: Expr.VarRef<number, any>
  let inner!: Expr.VarRef<string, any>
  Program.build(function*() {
    outer = yield* Binding.Const("value").pipe(Binding.Init(Expr.Number(1)))
    yield* Stmt.If(Expr.Boolean(true), function*() {
      inner = yield* Binding.Const("value").pipe(Binding.Init(Expr.String("inner")))
      yield* Stmt.Do(Fn.Call(FFI.Value<any>("use"), outer, inner))
    })
    return outer
  })

  assert.notEqual(outer.target, inner.target)
  assert.equal(literalValue(outer.type), 1)
  assert.equal(literalValue(inner.type), "inner")
})

test("local bindings are freshened around imported names", () => {
  const imported = FFI.Import<{ readonly read: () => string }>("files", "files")
  const program = Program.build(function*() {
    const local = yield* Binding.Const("files").pipe(Binding.Init(Expr.Number(1)))
    yield* Stmt.Do(Fn.Call(Expr.Prop(imported, "read")))
    return local
  })

  const expected = `import * as files from "files";\nconst files_2 = 1;\nfiles.read();`
  assert.equal(emitProgramTypeScript(program), expected)
  assert.equal(emitProgramBabel(program), expected)
})
