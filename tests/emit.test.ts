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
import { emitProgram as emitProgramTypeScript } from "../targets/typescript/index.ts"

// One program means the same thing through either target. These programs use
// no type syntax, so what a target emits is JavaScript and can simply be run.

const targets = { typescript: emitProgramTypeScript, babel: emitProgramBabel }

/** emits `const result = <value>` through each target, runs it, and hands back what `result` was */
const evaluated = (value: Expr.Expr<any>) => {
  const program = Program.build(function*() {
    yield* Binding.Const("result").pipe(Binding.Init(value))
    return null
  })
  const run = (code: string): unknown => new Function(`${code}\nreturn result`)()
  return { typescript: run(targets.typescript(program)), babel: run(targets.babel(program)) }
}

test("a numeric literal can be the receiver of a member access", () => {
  assert.deepEqual(evaluated(Fn.Call(Expr.Prop(Expr.Number(1), "toFixed"))), { typescript: "1", babel: "1" })
  // `-1 .toFixed()` would negate the string instead
  assert.deepEqual(evaluated(Fn.Call(Expr.Prop(Expr.Number(-1), "toFixed"))), { typescript: "-1", babel: "-1" })
  assert.deepEqual(evaluated(Expr.Binary("-", Expr.Number(2), Expr.Number(-1))), { typescript: 3, babel: 3 })
})

test("a template part is the string it produces, whatever it contains", () => {
  const part = "a`b${c}\\d"
  assert.deepEqual(evaluated(Expr.Template([part, "!"], Expr.Number(1))), { typescript: `${part}1!`, babel: `${part}1!` })
})

test("a template checks its arity at construction", () => {
  assert.throws(() => Expr.Template(["a", "b", "c"], Expr.Number(1)), /needs 2 parts, got 3/)
})

test("a reserved word is a fine property name and an invalid binding name, in both targets", () => {
  const property = Program.build(function*() {
    yield* Stmt.Do(Expr.Prop(FFI.Value<{ default: number }>("mod"), "default"))
    return null
  })
  const binding = Program.build(function*() {
    yield* Binding.Const("class").pipe(Binding.Init(Expr.Number(1)))
    return null
  })
  for (const emit of Object.values(targets)) {
    assert.equal(emit(property), "mod.default;")
    assert.throws(() => emit(binding), /cannot emit invalid identifier "class"/)
  }
})

test("a negative literal type spells the same in both targets", () => {
  const program = Program.build(function*() {
    yield* Type.Type("Below").pipe(Type.Body(Type.Union(Type.Literal(-1), Type.Literal(0))))
    return null
  })
  for (const emit of Object.values(targets)) assert.equal(emit(program), "type Below = -1 | 0;")
})
