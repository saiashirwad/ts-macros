import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"

const typeNode = (expr: Expr.Expr<any>): Type.Any | undefined => expr.type as Type.Any | undefined

const declarationType = (statement: Stmt.Statement): Type.Any | undefined =>
  (statement as { readonly type?: Type.TypeExpr<any> }).type as Type.Any | undefined

const primitiveName = (type: Type.Any | undefined): string | undefined => (type?.tag === "primitive" ? type.name : undefined)

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

test("annotate propagates oracle types through bindings and nested calls", () => {
  const external = FFI.Value("externalNumber")
  const call = FFI.Value<(value: number) => number>("readNumber")
  const program = Program.build(function*() {
    const first = yield* Binding.Const("first").pipe(Binding.Init(external))
    const second = yield* Binding.Const("second").pipe(Binding.Init(Expr.Binary("+", first, Expr.Number(1))))
    const third = yield* Binding.Const("third").pipe(Binding.Init(Expr.Binary("+", Fn.Call(call, Expr.Number(1)), second)))
    return third
  })

  assert.deepEqual(program.statements.map(declarationType), [undefined, undefined, undefined])

  const annotated = Program.annotate(program.statements, (node) =>
    node.name === "externalNumber"
      ? Type.Number()
      : node.name === "readNumber"
      ? Type.Function([Type.Number()], Type.Number())
      : undefined)

  assert.deepEqual(annotated.map((statement) => primitiveName(declarationType(statement))), ["number", "number", "number"])
})

test("annotate infers an unannotated function return through an oracle", () => {
  const program = Program.build(function*() {
    yield* Fn.Function("read").pipe(Fn.Impl(function*() {
      return FFI.Value("externalNumber")
    }))
    return null
  })

  assert.equal(declarationType(program.statements[0]!), undefined)

  const [read] = Program.annotate(program.statements, (node) => (node.name === "externalNumber" ? Type.Number() : undefined))
  const signature = declarationType(read!) as Type.FunctionType
  assert.equal(signature.tag, "function")
  assert.equal(primitiveName(signature.return as Type.Any), "number")
})

test("a body calling a function declared later still gets a return type", () => {
  const program = Program.build(function*() {
    const first = yield* Fn.Function("first").pipe(Fn.Impl(function*() {
      return Fn.Call(second)
    }))
    const second: Fn.FunctionRef<[], number> = yield* Fn.Function("second").pipe(Fn.Impl(function*() {
      return Expr.Number(1)
    }))
    return first
  })

  const signature = declarationType(program.statements[0]!) as Type.FunctionType
  assert.equal(signature.tag, "function")
  assert.equal(primitiveName(signature.return as Type.Any), "number")
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
})
