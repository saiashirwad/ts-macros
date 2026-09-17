import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

// The emitter writes text by hand, so what it writes has to mean what was
// built. These programs use no type syntax, so the output is JavaScript and
// can simply be run.

/** emits `const result = <value>`, runs it, and hands back what `result` was */
const evaluated = (value: Expr.Expr<any>): unknown => {
  const program = Program.build(function*() {
    yield* Binding.Const("result").pipe(Binding.Init(value))
    return null
  })
  return new Function(`${emitProgram(program)}\nreturn result`)()
}

test("a numeric literal can be the receiver of a member access", () => {
  assert.equal(evaluated(Fn.Call(Expr.Prop(Expr.Number(1), "toFixed"))), "1")
  // `-1.toFixed()` would negate the string instead
  assert.equal(evaluated(Fn.Call(Expr.Prop(Expr.Number(-1), "toFixed"))), "-1")
  assert.equal(evaluated(Expr.Binary("-", Expr.Number(2), Expr.Number(-1))), 3)
})

test("operators group the way the tree does, not the way the text reads", () => {
  const two = Expr.Number(2)
  assert.equal(evaluated(Expr.Binary("*", Expr.Binary("+", two, two), two)), 8)
  assert.equal(evaluated(Expr.Binary("-", two, Expr.Binary("-", two, two))), 2)
  assert.equal(evaluated(Expr.Unary("!", Expr.Binary("===", two, two))), false)
  assert.equal(evaluated(Expr.Binary("+", Expr.Cond(Expr.Boolean(true), two, two), two)), 4)
})

test("a template part is the string it produces, whatever it contains", () => {
  const part = "a`b${c}\\d"
  assert.equal(evaluated(Expr.Template([part, "!"], Expr.Number(1))), `${part}1!`)
})

test("a template checks its arity at construction", () => {
  assert.throws(() => Expr.Template(["a", "b", "c"], Expr.Number(1)), /needs 2 parts, got 3/)
})

test("a reserved word is a fine property name and an invalid binding name", () => {
  const property = Program.build(function*() {
    yield* Stmt.Do(Expr.Prop(FFI.Value<{ default: number }>("mod"), "default"))
    return null
  })
  const binding = Program.build(function*() {
    yield* Binding.Const("class").pipe(Binding.Init(Expr.Number(1)))
    return null
  })
  assert.equal(emitProgram(property), "mod.default;")
  assert.throws(() => emitProgram(binding), /cannot emit invalid identifier "class"/)
})

test("a negative literal type is spelled with its sign", () => {
  const program = Program.build(function*() {
    yield* Type.Type("Below", Type.Union(Type.Literal(-1), Type.Literal(0)))
    return null
  })
  assert.equal(emitProgram(program), "type Below = -1 | 0;")
})
