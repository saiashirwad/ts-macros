import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import { synthesize } from "../src/emit/index.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import type { BindingId } from "../src/identity.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram as emitProgramBabel } from "../targets/babel/index.ts"
import { insertFrees, owned } from "../targets/c/ownership.ts"
import { emitProgramTypeScript } from "../targets/typescript/index.ts"

const literalValue = (type: Type.TypeExpr<any> | null): string | number | boolean | null =>
  (type as Type.Any | null)?.tag === "literal" ? (type as Type.Literal).value : null

test("type synthesis distinguishes shadowed bindings by identity", () => {
  let outer!: Expr.VarRef<number, any>
  let inner!: Expr.VarRef<string, any>
  const program = Program.build(function*() {
    outer = yield* Binding.Const("value").pipe(Binding.Init(Expr.Number(1)))
    yield* Stmt.If(Expr.Boolean(true), function*() {
      inner = yield* Binding.Const("value").pipe(Binding.Init(Expr.String("inner")))
      yield* Stmt.Do(Fn.Call(FFI.Value<any>("use"), outer, inner))
    })
    return outer
  })

  const types = synthesize(program.statements)
  assert.equal(literalValue(types.tryTypeOf(outer)), 1)
  assert.equal(literalValue(types.tryTypeOf(inner)), "inner")
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

test("ownership lowering distinguishes shadowed bindings by identity", () => {
  let outer!: BindingId
  let inner!: BindingId
  const program = Program.build(function*() {
    const outerValue = yield* Binding.Const("value").pipe(
      Binding.Init(FFI.Value<string>("outer_value")),
      Binding.Annotate(owned(Type.String())),
    )
    outer = outerValue.target
    yield* Stmt.If(Expr.Boolean(true), function*() {
      const innerValue = yield* Binding.Const("value").pipe(
        Binding.Init(FFI.Value<string>("inner_value")),
        Binding.Annotate(owned(Type.String())),
      )
      inner = innerValue.target
      yield* Stmt.Do(Fn.Call(FFI.Value<any>("use"), outerValue, innerValue))
    })
    return Expr.Number(0)
  })

  const freed: BindingId[] = []
  insertFrees(program.statements, synthesize(program.statements), (_flavor, value) => {
    freed.push(value.target)
    return Stmt.Do(Fn.Call(FFI.Value<any>("release"), value))
  })

  assert.notEqual(outer, inner)
  assert.deepEqual(new Set(freed), new Set([outer, inner]))
})
