import assert from "node:assert/strict"
import { test } from "node:test"
import * as T from "../src/index.ts"

import { logicalType, substitute } from "../src/types/algebra.ts"

const typeNode = (expr: T.Expr<any>): T.AnyType | undefined => expr.type as T.AnyType | undefined

const declarationType = (statement: T.Statement): T.AnyType | undefined =>
  (statement as { readonly type?: T.Type<any> }).type as T.AnyType | undefined

const primitiveName = (type: T.AnyType | undefined): string | undefined => (type?.kind === "primitive" ? type.name : undefined)

test("compound expression annotations preserve all known alternatives", () => {
  const mixedArray = T.arrayLiteral(T.stringLiteral("text"), T.numberLiteral(1))
  const mixedCond = T.cond(T.booleanLiteral(true), T.stringLiteral("text"), T.numberLiteral(1))
  const mixedLogical = T.binary("&&", T.stringLiteral("text"), T.numberLiteral(1))

  assert.equal(typeNode(mixedArray)?.kind, "array")
  assert.equal(((typeNode(mixedArray) as T.ArrayType).element as T.AnyType).kind, "union")
  assert.equal(typeNode(mixedCond)?.kind, "union")
  assert.equal((typeNode(mixedLogical) as T.LiteralType).value, 1)
})

test("logical operators preserve TypeScript truthiness edges at runtime", () => {
  const unknown = T.Unknown
  const never = T.Never
  const number = T.Number
  const text = T.Literal("x")

  assert.equal((logicalType("&&", never, text) as T.Primitive).name, "never")
  assert.equal((logicalType("||", never, text) as T.Primitive).name, "never")
  assert.equal((logicalType("&&", unknown, text) as T.Primitive).name, "unknown")
  assert.equal((logicalType("||", unknown, text) as T.Object).kind, "object")
  assert.equal((logicalType("&&", number, text) as T.AnyType).kind, "union")
  assert.equal((logicalType("||", number, text) as T.AnyType).kind, "union")

  const withNever = T.Union(T.Never, T.Literal(false), T.Literal(true))
  const unionAnd = logicalType("&&", withNever, text) as T.Union
  assert.equal(unionAnd.members.some((member) => (member as T.AnyType).kind === "primitive" && (member as T.Primitive).name === "never"), false)
  const unionOr = logicalType("||", T.Union(T.Never, T.Literal(false)), text) as T.LiteralType
  assert.equal(unionOr.value, "x")

  const TParam = T.TypeParam("T")
  const symbolic = logicalType("&&", TParam, text) as T.Logical
  assert.equal(symbolic.kind, "logical")
  assert.equal(symbolic.op, "and")
  const reduced = substitute(symbolic, [TParam], [T.Literal(false)]) as T.LiteralType
  assert.equal(reduced.value, false)

  const negativeZeroAnd = T.binary("&&", T.numberLiteral(-0), T.stringLiteral("right"))
  const negativeZeroOr = T.binary("||", T.numberLiteral(-0), T.stringLiteral("right"))
  assert.equal(Object.is((negativeZeroAnd.type as T.LiteralType).value, -0), true)
  assert.equal((negativeZeroOr.type as T.LiteralType).value, "right")
})

test("an operator rejects operands it does not admit", () => {
  T.binary("+", T.stringLiteral("n="), T.numberLiteral(1))
  // @ts-expect-error - a string cannot be subtracted from
  T.binary("-", T.stringLiteral("text"), T.numberLiteral(1))
  // @ts-expect-error - nor can an object be compared
  T.binary("<", T.objectLiteral({ x: T.numberLiteral(1) }), T.numberLiteral(1))
  // @ts-expect-error - and the operator helper says the same
  T.sub("a", { x: 1 })
})

test("generic applications enforce arity and constraints", () => {
  const TParam = T.TypeParam("T", T.String)
  T.build(function*() {
    const Box = yield* T.type("Box", { params: [TParam], body: T.Object({ value: TParam }) })
    const boxed = T.Apply(Box, [T.Literal("valid")])
    assert.equal(boxed.args.length, 1)
    assert.equal((boxed.args[0] as T.LiteralType).value, "valid")
    // @ts-expect-error - Box needs one type argument
    T.Apply(Box, [])
    // @ts-expect-error - Box takes one type argument
    T.Apply(Box, [T.String, T.String])
    T.Apply(Box, [T.Any])
    // @ts-expect-error - unknown does not extend string
    T.Apply(Box, [T.Unknown])
    // @ts-expect-error - T must extend string
    T.Apply(Box, [T.Number])
    return null
  })
})

test("generic function instantiation enforces arity and constraints", () => {
  const TParam = T.TypeParam("T", T.String)
  T.build(function*() {
    const identity = yield* T.fn("identity", {
      typeParams: [TParam],
      params: [T.param("value", TParam)],
      body: function*({ value }) {
        return value
      },
    })
    const valid = T.instantiate(identity, T.Literal("valid"))
    assert.equal(valid.typeArgs.length, 1)
    assert.equal((valid.typeArgs[0] as T.LiteralType).value, "valid")
    T.instantiate(identity, T.Any)
    // @ts-expect-error - unknown does not extend string
    T.instantiate(identity, T.Unknown)
    // @ts-expect-error - identity needs one type argument
    T.instantiate(identity)
    // @ts-expect-error - identity takes one type argument
    T.instantiate(identity, T.String, T.String)
    // @ts-expect-error - T must extend string
    T.instantiate(identity, T.Number)
    return null
  })
})

test("generic applications substitute earlier arguments into dependent constraints", () => {
  const TParam = T.TypeParam("T", T.String)
  const UParam = T.TypeParam("U", TParam)
  T.build(function*() {
    const Pair = yield* T.type("Pair", { params: [TParam, UParam], body: T.Tuple(TParam, UParam) })
    const pair = T.Apply(Pair, [T.String, T.Literal("valid")])
    assert.equal(pair.args.length, 2)
    // @ts-expect-error - U must extend the argument supplied for T
    T.Apply(Pair, [T.Literal("specific"), T.String])

    const pairFn = yield* T.fn("pair", {
      typeParams: [TParam, UParam],
      params: [T.param("left", TParam), T.param("right", UParam)],
      body: function*({ right }) {
        return right
      },
    })
    const valid = T.instantiate(pairFn, T.String, T.Literal("valid"))
    assert.equal(valid.typeArgs.length, 2)
    // @ts-expect-error - U must extend the argument supplied for T
    T.instantiate(pairFn, T.Literal("specific"), T.String)
    return null
  })
})

test("a body calling a function declared later still gets a return type", () => {
  const program = T.build(function*() {
    const first = yield* T.fn("first", {
      body: function*() {
        return T.call(second)
      },
    })
    const second: T.FnRef<[], number, []> = yield* T.fn("second", {
      body: function*() {
        return T.numberLiteral(1)
      },
    })
    return first
  })

  const signature = declarationType(program.statements[0]!) as T.FunctionType
  assert.equal(signature.kind, "function")
  assert.equal(primitiveName(signature.return as T.AnyType), "number")
})

test("inferred functions preserve incompatible return branches", () => {
  const program = T.build(function*() {
    yield* T.fn("choose", {
      body: function*() {
        yield* T.if(T.booleanLiteral(true), function*() {
          yield* T.return(T.stringLiteral("text"))
        })
        return T.numberLiteral(1)
      },
    })
    return null
  })

  const declaration = program.statements[0] as T.BuiltFunction
  assert.equal(((declaration.type as T.FunctionType).return as T.AnyType).kind, "union")
})
