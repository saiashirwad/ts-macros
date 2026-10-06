import assert from "node:assert/strict"
import { test } from "node:test"
import * as $ from "../src/index.ts"

import { logicalType, substitute } from "../src/types/algebra.ts"

const typeNode = (expr: $.Expr<any>): $.AnyType | undefined => expr.type as $.AnyType | undefined

const declarationType = (statement: $.Statement): $.AnyType | undefined =>
  (statement as { readonly type?: $.Type<any> }).type as $.AnyType | undefined

const primitiveName = (type: $.AnyType | undefined): string | undefined => (type?.kind === "primitive" ? type.name : undefined)

test("compound expression annotations preserve all known alternatives", () => {
  const mixedArray = $.array($.string("text"), $.number(1))
  const mixedCond = $.cond($.boolean(true), $.string("text"), $.number(1))
  const mixedLogical = $.binary("&&", $.string("text"), $.number(1))

  assert.equal(typeNode(mixedArray)?.kind, "array")
  assert.equal(((typeNode(mixedArray) as $.Array).element as $.AnyType).kind, "union")
  assert.equal(typeNode(mixedCond)?.kind, "union")
  assert.equal((typeNode(mixedLogical) as $.Literal).value, 1)
})

test("logical operators preserve TypeScript truthiness edges at runtime", () => {
  const unknown = $.Unknown
  const never = $.Never
  const number = $.Number
  const text = $.Literal("x")

  assert.equal((logicalType("&&", never, text) as $.Primitive).name, "never")
  assert.equal((logicalType("||", never, text) as $.Primitive).name, "never")
  assert.equal((logicalType("&&", unknown, text) as $.Primitive).name, "unknown")
  assert.equal((logicalType("||", unknown, text) as $.Object).kind, "object")
  assert.equal((logicalType("&&", number, text) as $.AnyType).kind, "union")
  assert.equal((logicalType("||", number, text) as $.AnyType).kind, "union")

  const withNever = $.Union($.Never, $.Literal(false), $.Literal(true))
  const unionAnd = logicalType("&&", withNever, text) as $.Union
  assert.equal(unionAnd.members.some((member) => (member as $.AnyType).kind === "primitive" && (member as $.Primitive).name === "never"), false)
  const unionOr = logicalType("||", $.Union($.Never, $.Literal(false)), text) as $.Literal
  assert.equal(unionOr.value, "x")

  const T = $.TypeParam("T")
  const symbolic = logicalType("&&", T, text) as $.Logical
  assert.equal(symbolic.kind, "logical")
  assert.equal(symbolic.op, "and")
  const reduced = substitute(symbolic, [T], [$.Literal(false)]) as $.Literal
  assert.equal(reduced.value, false)

  const negativeZeroAnd = $.binary("&&", $.number(-0), $.string("right"))
  const negativeZeroOr = $.binary("||", $.number(-0), $.string("right"))
  assert.equal(Object.is((negativeZeroAnd.type as $.Literal).value, -0), true)
  assert.equal((negativeZeroOr.type as $.Literal).value, "right")
})

test("an operator rejects operands it does not admit", () => {
  $.binary("+", $.string("n="), $.number(1))
  // @ts-expect-error - a string cannot be subtracted from
  $.binary("-", $.string("text"), $.number(1))
  // @ts-expect-error - nor can an object be compared
  $.binary("<", $.object({ x: $.number(1) }), $.number(1))
  // @ts-expect-error - and the operator helper says the same
  $.sub("a", { x: 1 })
})

test("generic applications enforce arity and constraints", () => {
  const T = $.TypeParam("T", $.String)
  $.build(function*() {
    const Box = yield* $.type("Box", { params: [T], body: $.Object({ value: T }) })
    const boxed = $.Apply(Box, [$.Literal("valid")])
    assert.equal(boxed.args.length, 1)
    assert.equal((boxed.args[0] as $.Literal).value, "valid")
    // @ts-expect-error - Box needs one type argument
    $.Apply(Box, [])
    // @ts-expect-error - Box takes one type argument
    $.Apply(Box, [$.String, $.String])
    $.Apply(Box, [$.Any])
    // @ts-expect-error - unknown does not extend string
    $.Apply(Box, [$.Unknown])
    // @ts-expect-error - T must extend string
    $.Apply(Box, [$.Number])
    return null
  })
})

test("generic function instantiation enforces arity and constraints", () => {
  const T = $.TypeParam("T", $.String)
  $.build(function*() {
    const identity = yield* $.fn("identity", {
      typeParams: [T],
      params: [$.param("value", T)],
      body: function*({ value }) {
        return value
      },
    })
    const valid = $.instantiate(identity, $.Literal("valid"))
    assert.equal(valid.typeArgs.length, 1)
    assert.equal((valid.typeArgs[0] as $.Literal).value, "valid")
    $.instantiate(identity, $.Any)
    // @ts-expect-error - unknown does not extend string
    $.instantiate(identity, $.Unknown)
    // @ts-expect-error - identity needs one type argument
    $.instantiate(identity)
    // @ts-expect-error - identity takes one type argument
    $.instantiate(identity, $.String, $.String)
    // @ts-expect-error - T must extend string
    $.instantiate(identity, $.Number)
    return null
  })
})

test("generic applications substitute earlier arguments into dependent constraints", () => {
  const T = $.TypeParam("T", $.String)
  const U = $.TypeParam("U", T)
  $.build(function*() {
    const Pair = yield* $.type("Pair", { params: [T, U], body: $.Tuple(T, U) })
    const pair = $.Apply(Pair, [$.String, $.Literal("valid")])
    assert.equal(pair.args.length, 2)
    // @ts-expect-error - U must extend the argument supplied for T
    $.Apply(Pair, [$.Literal("specific"), $.String])

    const pairFn = yield* $.fn("pair", {
      typeParams: [T, U],
      params: [$.param("left", T), $.param("right", U)],
      body: function*({ right }) {
        return right
      },
    })
    const valid = $.instantiate(pairFn, $.String, $.Literal("valid"))
    assert.equal(valid.typeArgs.length, 2)
    // @ts-expect-error - U must extend the argument supplied for T
    $.instantiate(pairFn, $.Literal("specific"), $.String)
    return null
  })
})

test("a body calling a function declared later still gets a return type", () => {
  const program = $.build(function*() {
    const first = yield* $.fn("first", {
      body: function*() {
        return $.call(second)
      },
    })
    const second: $.FnRef<[], number, []> = yield* $.fn("second", {
      body: function*() {
        return $.number(1)
      },
    })
    return first
  })

  const signature = declarationType(program.statements[0]!) as $.Function
  assert.equal(signature.kind, "function")
  assert.equal(primitiveName(signature.return as $.AnyType), "number")
})

test("inferred functions preserve incompatible return branches", () => {
  const program = $.build(function*() {
    yield* $.fn("choose", {
      body: function*() {
        yield* $.if($.boolean(true), function*() {
          yield* $.return($.string("text"))
        })
        return $.number(1)
      },
    })
    return null
  })

  const declaration = program.statements[0] as $.BuiltFunction
  assert.equal(((declaration.type as $.Function).return as $.AnyType).kind, "union")
})
