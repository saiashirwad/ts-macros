import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram as emitJavaScript } from "../targets/js.ts"
import { emitProgram } from "../targets/ts.ts"

const evaluated = (value: Expr.Expr<any>): unknown => {
  const program = Program.build(function*() {
    yield* Decl.const("result", value)
    return null
  })
  const typescript = emitProgram(program)
  const javascript = emitJavaScript(program)
  assert.equal(javascript, typescript)
  const expected = new Function(`${typescript}\nreturn result`)()
  const result = new Function(`${javascript}\nreturn result`)()
  assert.deepEqual(result, expected)
  return result
}

test("a numeric literal can be the receiver of a member access", () => {
  assert.equal(evaluated(Expr.call(Expr.prop(Expr.number(1), "toFixed"))), "1")
  assert.equal(evaluated(Expr.call(Expr.prop(Expr.number(-1), "toFixed"))), "-1")
  assert.equal(evaluated(Expr.binary("-", Expr.number(2), Expr.number(-1))), 3)
})

test("numeric expressions preserve signed zero and reject non-finite values", () => {
  assert.equal(Object.is(evaluated(Expr.number(-0)), -0), true)
  assert.throws(() => Expr.number(NaN), /expression number must be finite, got NaN/)
  assert.throws(() => Expr.number(Infinity), /expression number must be finite, got Infinity/)
  assert.throws(() => Expr.number(-Infinity), /expression number must be finite, got -Infinity/)
  assert.throws(() => Expr.lift(NaN), /expression number must be finite, got NaN/)
  assert.throws(() => Expr.lift([Infinity]), /expression number must be finite, got Infinity/)
})

test("operators group the way the tree does, not the way the text reads", () => {
  const two = Expr.number(2)
  assert.equal(evaluated(Expr.binary("*", Expr.binary("+", two, two), two)), 8)
  assert.equal(evaluated(Expr.binary("-", two, Expr.binary("-", two, two))), 2)
  assert.equal(evaluated(Expr.unary("!", Expr.binary("===", two, two))), false)
  assert.equal(evaluated(Expr.binary("+", Expr.cond(Expr.boolean(true), two, two), two)), 4)
})

test("unary expressions parenthesize leading-negative numeric forms", () => {
  assert.equal(evaluated(Expr.unary("!", Expr.number(-1))), false)
  assert.equal(evaluated(Expr.unary("!", Expr.number(-0))), true)
  assert.equal(evaluated(Expr.unary("typeof", Expr.number(-1))), "number")
  assert.equal(evaluated(Expr.unary("typeof", Expr.number(-0))), "number")
})

test("a template part is the string it produces, whatever it contains", () => {
  const part = "a`b${c}\\d"
  assert.equal(evaluated(Expr.template([part, "!"], Expr.number(1))), `${part}1!`)
})

test("arrays, objects, indexing, and logical expressions preserve their values", () => {
  assert.deepEqual(evaluated(Expr.object({ value: Expr.array(Expr.number(1), Expr.number(2)) })), { value: [1, 2] })
  assert.equal(evaluated(Expr.index(Expr.array(Expr.string("first"), Expr.string("second")), Expr.number(1))), "second")
  assert.equal(evaluated(Expr.binary("&&", Expr.boolean(true), Expr.boolean(false))), false)
  assert.equal(evaluated(Expr.binary("||", Expr.boolean(false), Expr.boolean(true))), true)
})

test("a template checks its arity at construction", () => {
  assert.throws(() => Expr.template(["a", "b", "c"], Expr.number(1)), /needs 2 parts, got 3/)
})

test("imports and globals cannot share an emitted name", () => {
  const imported = FFI.Import<{ readonly value: string }>("external-package", "shared")
  const global = FFI.Value<{ readonly value: string }>("shared")
  const program = Program.build(function*() {
    yield* Stmt.if(Expr.boolean(true), function*() {
      yield* Stmt.do(Expr.prop(imported, "value"))
    })
    yield* Stmt.do(Expr.call(Expr.arrow({
      body: function*() {
        return Expr.prop(global, "value")
      },
    })))
    return null
  })

  for (const emit of [emitProgram, emitJavaScript]) {
    assert.throws(() => emit(program), /external name "shared" refers to both an import and a global/)
  }
})

test("repeated imports and globals with unambiguous names are allowed", () => {
  const imported = FFI.Import<{ readonly first: number; readonly second: number }>("external-package", "shared")
  const repeatedImport = FFI.Import<{ readonly first: number; readonly second: number }>("external-package", "shared")
  const global = FFI.Value<{ readonly value: number }>("hostValue")
  const repeatedGlobal = FFI.Value<{ readonly value: number }>("hostValue")
  const program = Program.build(function*() {
    yield* Stmt.do(Expr.prop(imported, "first"))
    yield* Stmt.do(Expr.prop(repeatedImport, "second"))
    yield* Stmt.do(Expr.prop(global, "value"))
    yield* Stmt.do(Expr.prop(repeatedGlobal, "value"))
    return null
  })

  assert.equal(
    emitProgram(program),
    `import * as shared from "external-package";\nshared.first;\nshared.second;\nhostValue.value;\nhostValue.value;`,
  )
})

test("a reserved word is a fine property name and an invalid binding name", () => {
  const property = Program.build(function*() {
    yield* Stmt.do(Expr.prop(FFI.Value<{ default: number }>("mod"), "default"))
    return null
  })
  const binding = Program.build(function*() {
    yield* Decl.const("class", Expr.number(1))
    return null
  })
  for (const emit of [emitProgram, emitJavaScript]) {
    assert.equal(emit(property), "mod.default;")
    assert.throws(() => emit(binding), /cannot emit invalid identifier "class"/)
  }
})

test("a negative literal type is spelled with its sign", () => {
  const program = Program.build(function*() {
    yield* Decl.type("Below", Type.union(Type.literal(-1), Type.literal(0)))
    return null
  })
  assert.equal(emitProgram(program), "type Below = -1 | 0;")
})

test("both targets emit __proto__ as an own data property", () => {
  const value = evaluated(Expr.object({ ["__proto__"]: 42, normal: "yes" }))
  assert.equal(Object.hasOwn(value as object, "__proto__"), true)
  assert.equal(Object.getOwnPropertyDescriptor(value, "__proto__")?.value, 42)
  assert.equal(Object.getPrototypeOf(value), Object.prototype)
})
