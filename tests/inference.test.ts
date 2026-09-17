import assert from "node:assert/strict"
import { test } from "node:test"

import * as Expr from "../src/expr.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Sugar from "../src/sugar/index.ts"
import * as Type from "../src/types/index.ts"

const typeNode = (expr: Expr.Expr<any>): Type.Any | undefined => expr.type as Type.Any | undefined

const declarationType = (statement: Stmt.Statement): Type.Any | undefined =>
  (statement as { readonly type?: Type.TypeExpr<any> }).type as Type.Any | undefined

const primitiveName = (type: Type.Any | undefined): string | undefined => (type?.tag === "primitive" ? type.name : undefined)

test("compound expression annotations preserve all known alternatives", () => {
  const mixedArray = Expr.Array(Expr.String("text"), Expr.Number(1))
  const mixedCond = Expr.Cond(Expr.Boolean(true), Expr.String("text"), Expr.Number(1))
  const mixedLogical = Expr.Binary("&&", Expr.String("text"), Expr.Number(1))

  assert.equal(typeNode(mixedArray)?.tag, "array")
  assert.equal(((typeNode(mixedArray) as Type.ArrayType).element as Type.Any).tag, "union")
  assert.equal(typeNode(mixedCond)?.tag, "union")
  assert.equal(typeNode(mixedLogical)?.tag, "union")
})

test("an operator rejects operands it does not admit", () => {
  Expr.Binary("+", Expr.String("n="), Expr.Number(1))
  // @ts-expect-error - a string cannot be subtracted from
  Expr.Binary("-", Expr.String("text"), Expr.Number(1))
  // @ts-expect-error - nor can an object be compared
  Expr.Binary("<", Expr.Object({ x: Expr.Number(1) }), Expr.Number(1))
  // @ts-expect-error - and the sugar says the same
  Sugar.sub("a", { x: 1 })
})

test("generic applications enforce arity and constraints", () => {
  const T = Type.Param("T", Type.String())
  Program.build(function*() {
    const Box = yield* Type.Type("Box", Type.Object({ value: T })).pipe(Type.TypeParams(T))
    const boxed = Type.Apply(Box, [Type.Literal("valid")])
    assert.equal(boxed.args.length, 1)
    assert.equal((boxed.args[0] as Type.Literal).value, "valid")
    // @ts-expect-error - Box needs one type argument
    Type.Apply(Box, [])
    // @ts-expect-error - Box takes one type argument
    Type.Apply(Box, [Type.String(), Type.String()])
    Type.Apply(Box, [Type.Any()])
    // @ts-expect-error - unknown does not extend string
    Type.Apply(Box, [Type.Unknown()])
    // @ts-expect-error - T must extend string
    Type.Apply(Box, [Type.Number()])
    return null
  })
})

test("generic function instantiation enforces arity and constraints", () => {
  const T = Type.Param("T", Type.String())
  Program.build(function*() {
    const identity = yield* Fn.Function("identity").pipe(
      Fn.TypeParams(T),
      Fn.Params(Fn.Param("value", T)),
      Fn.Impl(function*({ value }) {
        return value
      }),
    )
    const valid = Fn.Instantiate(identity, Type.Literal("valid"))
    assert.equal(valid.typeArgs.length, 1)
    assert.equal((valid.typeArgs[0] as Type.Literal).value, "valid")
    Fn.Instantiate(identity, Type.Any())
    // @ts-expect-error - unknown does not extend string
    Fn.Instantiate(identity, Type.Unknown())
    // @ts-expect-error - identity needs one type argument
    Fn.Instantiate(identity)
    // @ts-expect-error - identity takes one type argument
    Fn.Instantiate(identity, Type.String(), Type.String())
    // @ts-expect-error - T must extend string
    Fn.Instantiate(identity, Type.Number())
    return null
  })
})

test("generic applications substitute earlier arguments into dependent constraints", () => {
  const T = Type.Param("T", Type.String())
  const U = Type.Param("U", T)
  Program.build(function*() {
    const Pair = yield* Type.Type("Pair", Type.Tuple(T, U)).pipe(Type.TypeParams(T, U))
    const pair = Type.Apply(Pair, [Type.String(), Type.Literal("valid")])
    assert.equal(pair.args.length, 2)
    // @ts-expect-error - U must extend the argument supplied for T
    Type.Apply(Pair, [Type.Literal("specific"), Type.String()])

    const pairFn = yield* Fn.Function("pair").pipe(
      Fn.TypeParams(T, U),
      Fn.Params(Fn.Param("left", T), Fn.Param("right", U)),
      Fn.Impl(function*({ right }) {
        return right
      }),
    )
    const valid = Fn.Instantiate(pairFn, Type.String(), Type.Literal("valid"))
    assert.equal(valid.typeArgs.length, 2)
    // @ts-expect-error - U must extend the argument supplied for T
    Fn.Instantiate(pairFn, Type.Literal("specific"), Type.String())
    return null
  })
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
