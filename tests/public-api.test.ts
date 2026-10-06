import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { expectTypeOf } from "./typing.ts"

test("lowercase expressions stay distinct from capitalized type nodes", () => {
  const number = $.number(1)
  const string = $.string("value")
  const boolean = $.boolean(true)
  const nil = $.null()
  const array = $.array(1, 2)
  const object = $.object({ value: 1 })
  const external = $.external<Date>("today", undefined)

  expectTypeOf<$.Denotes<typeof number>>().toEqualTypeOf<1>()
  expectTypeOf<$.Denotes<typeof string>>().toEqualTypeOf<"value">()
  expectTypeOf<$.Denotes<typeof boolean>>().toEqualTypeOf<true>()
  expectTypeOf<$.Denotes<typeof nil>>().toEqualTypeOf<null>()
  expectTypeOf<$.Denotes<typeof array>>().toEqualTypeOf<number[]>()
  expectTypeOf<$.Denotes<typeof object>>().toEqualTypeOf<{ value: number }>()
  expectTypeOf<$.Denotes<typeof external>>().toEqualTypeOf<Date>()

  assert.equal(number.kind, "literal")
  assert.equal(string.kind, "literal")
  assert.equal(boolean.kind, "literal")
  assert.equal(nil.value, null)
  assert.equal(array.kind, "array")
  assert.equal(object.kind, "object")
  assert.equal(external.kind, "external")
  assert.equal($.Number.name, "number")
  assert.equal($.String.name, "string")
  assert.equal($.Boolean.name, "boolean")
  assert.equal($.Null.name, "null")
  assert.equal($.Array($.Number).element, $.Number)
  assert.equal($.Object({ value: $.Number }).fields.value, $.Number)
  assert.equal($.External<Date>("Date").name, "Date")

  for (
    const name of [
      "Decl",
      "Expr",
      "FFI",
      "Guard",
      "Program",
      "Stmt",
      "Type",
      "numberLiteral",
      "stringLiteral",
      "booleanLiteral",
      "nullLiteral",
      "arrayLiteral",
      "objectLiteral",
      "externalValue",
    ]
  ) assert.equal(Object.hasOwn($, name), false, name)
})

test("type constructors and node interfaces share names and preserve denotations", () => {
  const literal: $.Literal<"value"> = $.Literal("value")
  const template: $.Template<readonly ["id-", ""], [typeof $.Number]> = $.Template(["id-", ""], $.Number)
  const array: $.Array<typeof $.Number> = $.Array($.Number)
  const readonlyArray: $.ReadonlyArray<typeof $.Number> = $.ReadonlyArray($.Number)
  const tuple: $.Tuple<[typeof $.String, typeof $.Number]> = $.Tuple($.String, $.Number)
  const fn: $.Function<[typeof $.Number], typeof $.String, undefined> = $.Function([$.Number], $.String)
  const external: $.External<Date> = $.External<Date>("Date")
  const infer: $.Infer<"Item"> = $.Infer("Item")

  expectTypeOf<$.TypeDenotes<typeof literal>>().toEqualTypeOf<"value">()
  expectTypeOf<$.TypeDenotes<typeof template>>().toEqualTypeOf<`id-${number}`>()
  expectTypeOf<$.TypeDenotes<typeof array>>().toEqualTypeOf<number[]>()
  expectTypeOf<$.TypeDenotes<typeof readonlyArray>>().toEqualTypeOf<readonly number[]>()
  expectTypeOf<$.TypeDenotes<typeof tuple>>().toEqualTypeOf<[string, number]>()
  expectTypeOf<$.TypeDenotes<typeof fn>>().toEqualTypeOf<(arg: number) => string>()
  expectTypeOf<$.TypeDenotes<typeof external>>().toEqualTypeOf<Date>()
  expectTypeOf<$.TypeDenotes<typeof infer>>().toEqualTypeOf<$.Inferred<"Item">>()

  assert.equal(array.readonly, false)
  assert.equal(readonlyArray.readonly, true)
  assert.equal(tuple.items[0], $.String)
  assert.equal(fn.return, $.String)
  assert.equal(infer.name, "Item")
})

test("the dollar alias coexists with local T bindings and generic parameters", () => {
  const arrayOf = <T>(type: $.Type<T>): $.Array<$.Type<T>> => $.Array(type)
  assert.equal(arrayOf($.Number).element, $.Number)
  const program = $.build(function*() {
    const T = $.TypeParam("T")
    return yield* $.fn("identity", {
      typeParams: [T],
      params: [$.param("value", T)],
      body: function*({ value }) {
        return value
      },
    })
  })
  assert.equal(emitProgram(program), "function identity<T>(value: T) {\n  return value;\n}")
})
