import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { sameType } from "../src/types/algebra.ts"
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

test("a helper may declare the same const hint twice in one scope", () => {
  function* helper() {
    return yield* Decl.const_("tmp", 1)
  }
  const program = Program.build(function*() {
    const first = yield* helper()
    const second = yield* helper()
    yield* Decl.const_("sum", Expr.add(first, second))
    return { first, second }
  })
  assert.notEqual(program.result.first.id, program.result.second.id)
  assert.equal(emitProgram(program), "const tmp = 1;\nconst tmp_2 = 1;\nconst sum = tmp + tmp_2;")
})

test("a helper may declare the same alias hint twice in one scope", () => {
  function* helper() {
    const alias = yield* Decl.type_("Tmp", { params: [Type.param("T")], body: ({ T }) => Type.array(T) })
    yield* Decl.const_("tmp", [1], Type.apply(alias, [Type.number]))
    return alias
  }
  const program = Program.build(function*() {
    const first = yield* helper()
    const second = yield* helper()
    return { first, second }
  })
  assert.notEqual(program.result.first.id, program.result.second.id)
  assert.equal(sameType(program.result.first, program.result.second), false)
  assert.equal(emitProgram(program), "type Tmp<T> = T[];\nconst tmp: Tmp<number> = [1];\ntype Tmp_2<T> = T[];\nconst tmp_2: Tmp_2<number> = [1];")
})

test("alias references cannot escape their block", () => {
  let alias!: Type.TypeRef<string>
  assert.throws(() =>
    Program.build(function*() {
      yield* Stmt.if_(true, function*() {
        alias = yield* Decl.type_("Local", Type.string)
      })
      yield* Decl.const_("value", "x", alias)
      return null
    }), /does not resolve to an in-scope binding/)
})
