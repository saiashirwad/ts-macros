// oxlint-disable typescript/no-wrapper-object-types -- These tests specifically verify rejection of Object.
import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("erased object types have clear recursive lift diagnostics", () => {
  assertType<Equal<T.CheckLift<{}>, ["cannot lift a value typed", {}]>>()
  assertType<Equal<T.CheckLift<object>, ["cannot lift a value typed", object]>>()
  assertType<Equal<T.CheckLift<Object>, ["cannot lift a value typed", Object]>>()
  assertType<Equal<T.CheckLift<{ values: readonly { child: object }[] }>, ["cannot lift a value typed", object]>>()
  assertType<Equal<T.CheckLift<{ child?: {} }>, ["cannot lift a value typed", {}]>>()
  assertType<Equal<T.CheckLift<string | Object>, ["cannot lift a value typed", Object]>>()
  type Tree = { children: Tree[]; value: {} }
  assertType<Equal<T.CheckLift<Tree>, ["cannot lift a value typed", {}]>>()
  assertType<Equal<T.Lift<{} | object | Object>, never>>()
})

test("explicit empty object nodes lift and emit normally", () => {
  const empty = T.objectLiteral({})
  assert.equal(T.lift(empty), empty)
  assert.equal(T.lift({ nested: empty }).kind, "object")
  assert.equal(T.arrayLiteral(empty).kind, "array")
  const program = T.build(function*() {
    return yield* T.const("actual", empty)
  })
  assert.equal(emitProgram(program), "const actual = {};")
  const external = T.hostValue<object>("external")
  assert.equal(T.lift(external), external)
  assert.equal(T.call(T.hostValue<(value: {}) => void>("consume"), { value: 1 }).kind, "call")
})

interface ErasedInputs {
  readonly empty: {}
  readonly object: object
  readonly boxed: Object
}

const rejectErasedValues = ({ empty, object, boxed }: ErasedInputs) => {
  // @ts-expect-error use T.objectLiteral({}) for an empty object literal
  T.lift({})
  // @ts-expect-error erased empty-object types cannot be lifted
  T.lift(empty)
  // @ts-expect-error the object type carries no liftable structure
  T.lift(object)
  // @ts-expect-error Object carries no liftable structure
  T.lift(boxed)
  // @ts-expect-error object fields use the same recursive check
  T.objectLiteral({ nested: empty })
  // @ts-expect-error array elements use the same recursive check
  T.arrayLiteral(boxed)
  // @ts-expect-error nested arrays must not hide erased types
  T.lift({ nested: [object] })
  // @ts-expect-error an erased argument cannot be passed to a broad FFI parameter
  T.call(T.hostValue<(value: typeof object) => void>("consume"), object)
  // @ts-expect-error statement values use the same lift check
  T.return(empty)
  T.build(function*() {
    // @ts-expect-error function finals must reject erased values
    return yield* T.fn("invalid", {
      body: function*() {
        return empty
      },
    })
  })
  const arrow = T.arrow({
    body: function*() {
      return boxed
    },
  })
  // @ts-expect-error arrow finals must reject erased values
  T.const("invalid", arrow)
  T.build(function*() {
    // @ts-expect-error an annotation cannot repair the stage-1 value's erased type
    return yield* T.const("invalid", empty, T.Object({}))
  })
}
void rejectErasedValues
