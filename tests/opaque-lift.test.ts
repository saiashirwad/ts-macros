// oxlint-disable typescript/no-wrapper-object-types -- These tests specifically verify rejection of Object.
import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("erased object types have clear recursive lift diagnostics", () => {
  assertType<Equal<$.CheckLift<{}>, ["cannot lift a value typed", {}]>>()
  assertType<Equal<$.CheckLift<object>, ["cannot lift a value typed", object]>>()
  assertType<Equal<$.CheckLift<Object>, ["cannot lift a value typed", Object]>>()
  assertType<Equal<$.CheckLift<{ values: readonly { child: object }[] }>, ["cannot lift a value typed", object]>>()
  assertType<Equal<$.CheckLift<{ child?: {} }>, ["cannot lift a value typed", {}]>>()
  assertType<Equal<$.CheckLift<string | Object>, ["cannot lift a value typed", Object]>>()
  type Tree = { children: Tree[]; value: {} }
  assertType<Equal<$.CheckLift<Tree>, ["cannot lift a value typed", {}]>>()
  assertType<Equal<$.Lift<{} | object | Object>, never>>()
})

test("explicit empty object nodes lift and emit normally", () => {
  const empty = $.object({})
  assert.equal($.lift(empty), empty)
  assert.equal($.lift({ nested: empty }).kind, "object")
  assert.equal($.array(empty).kind, "array")
  const program = $.build(function*() {
    return yield* $.const("actual", empty)
  })
  assert.equal(emitProgram(program), "const actual = {};")
  const external = $.hostValue<object>("external")
  assert.equal($.lift(external), external)
  assert.equal($.call($.hostValue<(value: {}) => void>("consume"), { value: 1 }).kind, "call")
})

interface ErasedInputs {
  readonly empty: {}
  readonly object: object
  readonly boxed: Object
}

const rejectErasedValues = ({ empty, object, boxed }: ErasedInputs) => {
  // @ts-expect-error use $.object({}) for an empty object literal
  $.lift({})
  // @ts-expect-error erased empty-object types cannot be lifted
  $.lift(empty)
  // @ts-expect-error the object type carries no liftable structure
  $.lift(object)
  // @ts-expect-error Object carries no liftable structure
  $.lift(boxed)
  // @ts-expect-error object fields use the same recursive check
  $.object({ nested: empty })
  // @ts-expect-error array elements use the same recursive check
  $.array(boxed)
  // @ts-expect-error nested arrays must not hide erased types
  $.lift({ nested: [object] })
  // @ts-expect-error an erased argument cannot be passed to a broad FFI parameter
  $.call($.hostValue<(value: typeof object) => void>("consume"), object)
  // @ts-expect-error statement values use the same lift check
  $.return(empty)
  $.build(function*() {
    // @ts-expect-error function finals must reject erased values
    return yield* $.fn("invalid", {
      body: function*() {
        return empty
      },
    })
  })
  const arrow = $.arrow({
    body: function*() {
      return boxed
    },
  })
  // @ts-expect-error arrow finals must reject erased values
  $.const("invalid", arrow)
  $.build(function*() {
    // @ts-expect-error an annotation cannot repair the stage-1 value's erased type
    return yield* $.const("invalid", empty, $.Object({}))
  })
}
void rejectErasedValues
