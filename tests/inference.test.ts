import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import { synthesize } from "../src/emit/index.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram as emitProgramBabel } from "../targets/babel/index.ts"
import { emitProgramC } from "../targets/c/index.ts"
import { emitProgramTypeScript } from "../targets/typescript/index.ts"

const typeNode = (expr: Expr.Expr<any>): Type.Any | undefined => expr.type as Type.Any | undefined

test("compound expression annotations preserve all known alternatives", () => {
  const mixedArray = Expr.Array(Expr.String("text"), Expr.Number(1))
  const mixedCond = Expr.Cond(Expr.Boolean(true), Expr.String("text"), Expr.Number(1))
  const mixedLogical = Expr.Binary("&&", Expr.String("text"), Expr.Number(1))
  const invalidArithmetic = Expr.Binary("-", Expr.String("text"), Expr.Number(1))

  assert.equal(typeNode(mixedArray)?.tag, "array")
  assert.equal(((typeNode(mixedArray) as Type.ArrayType).element as Type.Any).tag, "union")
  assert.equal(typeNode(mixedCond)?.tag, "union")
  assert.equal(typeNode(mixedLogical)?.tag, "union")
  assert.equal(invalidArithmetic.type, undefined)
})

test("synthesis propagates oracle types through bindings and nested calls", () => {
  const external = FFI.Value("externalNumber")
  const call = FFI.Value<(value: number) => number>("readNumber")
  const program = Program.build(function*() {
    const first = yield* Binding.Const("first").pipe(Binding.Init(external))
    const second = yield* Binding.Const("second").pipe(Binding.Init(Expr.Binary("+", first, Expr.Number(1))))
    const third = yield* Binding.Const("third").pipe(Binding.Init(Expr.Binary("+", Fn.Call(call, Expr.Number(1)), second)))
    return third
  })

  assert.equal(
    emitProgramC(program, {
      externalRef: (node) =>
        node.name === "externalNumber"
          ? Type.Number()
          : node.name === "readNumber"
          ? Type.Function([Type.Number()], Type.Number())
          : null,
    }),
    `const double first = externalNumber;
const double second = first + 1;
const double third = readNumber(1) + second;`,
  )
})

test("synthesis infers an unannotated function return through an oracle", () => {
  const program = Program.build(function*() {
    yield* Fn.Function("read").pipe(Fn.Impl(function*() {
      return FFI.Value("externalNumber")
    }))
    return null
  })

  assert.equal(
    emitProgramC(program, { externalRef: (node) => node.name === "externalNumber" ? Type.Number() : null }),
    `double read(void) {
  return externalNumber;
}`,
  )
})

test("inferred functions preserve incompatible return branches", () => {
  const program = Program.build(function*() {
    yield* Fn.Function("choose").pipe(Fn.Impl(function*() {
      yield* Stmt.If(Expr.Boolean(true), function*() {
        yield* Stmt.Return(Expr.String("text"))
      })
      return Expr.Number(1)
    }))
    return null
  })

  const declaration = program.statements[0] as Fn.FunctionDeclaration
  assert.equal(((declaration.type as Type.FunctionType).return as Type.Any).tag, "union")
  assert.throws(() => emitProgramC(program), /no union types/)
})

test("Type.Apply preserves applications of nominal refs in TS emitters", () => {
  const Box = Type.Nominal("Box", Type.Object({ value: Type.String() }))
  const BoxString = Type.Apply(Box, [Type.String()])
  const program = Program.build(function*() {
    yield* Fn.Function("take").pipe(
      Fn.Params(Fn.Param("box", BoxString)),
      Fn.Returns(BoxString),
      Fn.Impl(function*({ box }) {
        return box
      }),
    )
    return null
  })

  assert.match(emitProgramTypeScript(program), /box: Box<string>/)
  assert.match(emitProgramTypeScript(program), /: Box<string>/)
  assert.match(emitProgramBabel(program), /box: Box<string>/)
  assert.match(emitProgramBabel(program), /: Box<string>/)
})

test("the shared synthesizer still distinguishes binding identities", () => {
  let outer!: Expr.VarRef<number, any>
  let inner!: Expr.VarRef<string, any>
  const program = Program.build(function*() {
    outer = yield* Binding.Const("value").pipe(Binding.Init(Expr.Number(1)))
    yield* Stmt.If(Expr.Boolean(true), function*() {
      inner = yield* Binding.Const("value").pipe(Binding.Init(Expr.String("inner")))
    })
    return outer
  })

  const types = synthesize(program.statements)
  assert.equal((types.tryTypeOf(outer) as Type.Literal).value, 1)
  assert.equal((types.tryTypeOf(inner) as Type.Literal).value, "inner")
})
