import assert from "node:assert/strict"
import { test } from "node:test"

import * as Expr from "../src/expr.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { logicalType, substitute } from "../src/types/lattice.ts"

/** `Stmt.fn` intersects a successful spec with `[]`, which blocks inference; this calls the same constructor. */
function fn<
  const Params extends Expr.AnyParams = [],
  Declared = unknown,
  const TypeParams extends Type.AnyParams = [],
  Yields extends Stmt.NonLoopStatement = Stmt.NonLoopStatement,
  Final = unknown,
>(
  name: string,
  spec: Stmt.FnSpec<Params, Declared, TypeParams, Yields, Final>,
) {
  return Stmt.fn<Params, Declared, TypeParams, Yields, Final>(name, spec as never)
}

const typeNode = (expr: Expr.Expr<any>): Type.Any | undefined => expr.type as Type.Any | undefined

const declarationType = (statement: Stmt.Statement): Type.Any | undefined =>
  (statement as { readonly type?: Type.Type<any> }).type as Type.Any | undefined

const primitiveName = (type: Type.Any | undefined): string | undefined => (type?.kind === "primitive" ? type.name : undefined)

test("compound expression annotations preserve all known alternatives", () => {
  const mixedArray = Expr.array(Expr.string("text"), Expr.number(1))
  const mixedCond = Expr.cond(Expr.boolean(true), Expr.string("text"), Expr.number(1))
  const mixedLogical = Expr.binary("&&", Expr.string("text"), Expr.number(1))

  assert.equal(typeNode(mixedArray)?.kind, "array")
  assert.equal(((typeNode(mixedArray) as Type.ArrayType).element as Type.Any).kind, "union")
  assert.equal(typeNode(mixedCond)?.kind, "union")
  assert.equal((typeNode(mixedLogical) as Type.Literal).value, 1)
})

test("logical operators preserve TypeScript truthiness edges at runtime", () => {
  const unknown = Type.unknown
  const never = Type.never
  const number = Type.number
  const text = Type.literal("x")

  assert.equal((logicalType("&&", never, text) as Type.Primitive).name, "never")
  assert.equal((logicalType("||", never, text) as Type.Primitive).name, "never")
  assert.equal((logicalType("&&", unknown, text) as Type.Primitive).name, "unknown")
  assert.equal((logicalType("||", unknown, text) as Type.Object).kind, "object")
  assert.equal((logicalType("&&", number, text) as Type.Any).kind, "union")
  assert.equal((logicalType("||", number, text) as Type.Any).kind, "union")

  const withNever = Type.union(Type.never, Type.literal(false), Type.literal(true))
  const unionAnd = logicalType("&&", withNever, text) as Type.Union
  assert.equal(unionAnd.members.some((member) => (member as Type.Any).kind === "primitive" && (member as Type.Primitive).name === "never"), false)
  const unionOr = logicalType("||", Type.union(Type.never, Type.literal(false)), text) as Type.Literal
  assert.equal(unionOr.value, "x")

  const T = Type.param("T")
  const symbolic = logicalType("&&", T, text) as Type.Logical
  assert.equal(symbolic.kind, "logical")
  assert.equal(symbolic.op, "and")
  const reduced = substitute(symbolic, [T], [Type.literal(false)]) as Type.Literal
  assert.equal(reduced.value, false)

  const negativeZeroAnd = Expr.binary("&&", Expr.number(-0), Expr.string("right"))
  const negativeZeroOr = Expr.binary("||", Expr.number(-0), Expr.string("right"))
  assert.equal(Object.is((negativeZeroAnd.type as Type.Literal).value, -0), true)
  assert.equal((negativeZeroOr.type as Type.Literal).value, "right")
})

test("an operator rejects operands it does not admit", () => {
  Expr.binary("+", Expr.string("n="), Expr.number(1))
  // @ts-expect-error - a string cannot be subtracted from
  Expr.binary("-", Expr.string("text"), Expr.number(1))
  // @ts-expect-error - nor can an object be compared
  Expr.binary("<", Expr.object({ x: Expr.number(1) }), Expr.number(1))
  // @ts-expect-error - and the operator helper says the same
  Expr.sub("a", { x: 1 })
})

test("generic applications enforce arity and constraints", () => {
  const T = Type.param("T", Type.string)
  Program.build(function*() {
    const Box = yield* Type.type_("Box", { params: [T], body: Type.object({ value: T }) })
    const boxed = Type.apply(Box, [Type.literal("valid")])
    assert.equal(boxed.args.length, 1)
    assert.equal((boxed.args[0] as Type.Literal).value, "valid")
    // @ts-expect-error - Box needs one type argument
    Type.apply(Box, [])
    // @ts-expect-error - Box takes one type argument
    Type.apply(Box, [Type.string, Type.string])
    Type.apply(Box, [Type.any])
    // @ts-expect-error - unknown does not extend string
    Type.apply(Box, [Type.unknown])
    // @ts-expect-error - T must extend string
    Type.apply(Box, [Type.number])
    return null
  })
})

test("generic function instantiation enforces arity and constraints", () => {
  const T = Type.param("T", Type.string)
  Program.build(function*() {
    const identity = yield* fn("identity", {
      typeParams: [T],
      params: [Expr.param("value", T)],
      body: function*({ value }) {
        return value
      },
    })
    const valid = Expr.instantiate(identity, Type.literal("valid"))
    assert.equal(valid.typeArgs.length, 1)
    assert.equal((valid.typeArgs[0] as Type.Literal).value, "valid")
    Expr.instantiate(identity, Type.any)
    // @ts-expect-error - unknown does not extend string
    Expr.instantiate(identity, Type.unknown)
    // @ts-expect-error - identity needs one type argument
    Expr.instantiate(identity)
    // @ts-expect-error - identity takes one type argument
    Expr.instantiate(identity, Type.string, Type.string)
    // @ts-expect-error - T must extend string
    Expr.instantiate(identity, Type.number)
    return null
  })
})

test("generic applications substitute earlier arguments into dependent constraints", () => {
  const T = Type.param("T", Type.string)
  const U = Type.param("U", T)
  Program.build(function*() {
    const Pair = yield* Type.type_("Pair", { params: [T, U], body: Type.tuple(T, U) })
    const pair = Type.apply(Pair, [Type.string, Type.literal("valid")])
    assert.equal(pair.args.length, 2)
    // @ts-expect-error - U must extend the argument supplied for T
    Type.apply(Pair, [Type.literal("specific"), Type.string])

    const pairFn = yield* fn("pair", {
      typeParams: [T, U],
      params: [Expr.param("left", T), Expr.param("right", U)],
      body: function*({ right }) {
        return right
      },
    })
    const valid = Expr.instantiate(pairFn, Type.string, Type.literal("valid"))
    assert.equal(valid.typeArgs.length, 2)
    // @ts-expect-error - U must extend the argument supplied for T
    Expr.instantiate(pairFn, Type.literal("specific"), Type.string)
    return null
  })
})

test("a body calling a function declared later still gets a return type", () => {
  const program = Program.build(function*() {
    const first = yield* fn("first", {
      body: function*() {
        return Expr.call(second)
      },
    })
    const second: Expr.FnRef<[], number, []> = yield* fn("second", {
      body: function*() {
        return Expr.number(1)
      },
    })
    return first
  })

  const signature = declarationType(program.statements[0]!) as Type.FunctionType
  assert.equal(signature.kind, "function")
  assert.equal(primitiveName(signature.return as Type.Any), "number")
})

test("inferred functions preserve incompatible return branches", () => {
  const program = Program.build(function*() {
    yield* fn("choose", {
      body: function*() {
        yield* Stmt.if_(Expr.boolean(true), function*() {
          yield* Stmt.return_(Expr.string("text"))
        })
        return Expr.number(1)
      },
    })
    return null
  })

  const declaration = program.statements[0] as Stmt.FunctionDeclaration
  assert.equal(((declaration.type as Type.FunctionType).return as Type.Any).kind, "union")
})
