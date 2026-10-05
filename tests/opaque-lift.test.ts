// oxlint-disable typescript/no-wrapper-object-types -- These tests specifically verify rejection of Object.
import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"
import { assertType } from "./typing.ts"
import type { Equal } from "./typing.ts"

test("erased object types have clear recursive lift diagnostics", () => {
  assertType<Equal<Expr.CheckLift<{}>, ["cannot lift a value typed", {}]>>()
  assertType<Equal<Expr.CheckLift<object>, ["cannot lift a value typed", object]>>()
  assertType<Equal<Expr.CheckLift<Object>, ["cannot lift a value typed", Object]>>()
  assertType<Equal<Expr.CheckLift<{ values: readonly { child: object }[] }>, ["cannot lift a value typed", object]>>()
  assertType<Equal<Expr.CheckLift<{ child?: {} }>, ["cannot lift a value typed", {}]>>()
  assertType<Equal<Expr.CheckLift<string | Object>, ["cannot lift a value typed", Object]>>()
  type Tree = { children: Tree[]; value: {} }
  assertType<Equal<Expr.CheckLift<Tree>, ["cannot lift a value typed", {}]>>()
  assertType<Equal<Expr.Lift<{} | object | Object>, never>>()
})

test("explicit empty object nodes lift and emit normally", () => {
  const empty = Expr.object({})
  assert.equal(Expr.lift(empty), empty)
  assert.equal(Expr.lift({ nested: empty }).kind, "object")
  assert.equal(Expr.array(empty).kind, "array")
  const program = Program.build(function*() {
    return yield* Decl.const("actual", empty)
  })
  assert.equal(emitProgram(program), "const actual = {};")
  const external = FFI.Value<object>("external")
  assert.equal(Expr.lift(external), external)
  assert.equal(Expr.call(FFI.Value<(value: {}) => void>("consume"), { value: 1 }).kind, "call")
})

interface ErasedInputs {
  readonly empty: {}
  readonly object: object
  readonly boxed: Object
}

const rejectErasedValues = ({ empty, object, boxed }: ErasedInputs) => {
  // @ts-expect-error use Expr.object({}) for an empty object literal
  Expr.lift({})
  // @ts-expect-error erased empty-object types cannot be lifted
  Expr.lift(empty)
  // @ts-expect-error the object type carries no liftable structure
  Expr.lift(object)
  // @ts-expect-error Object carries no liftable structure
  Expr.lift(boxed)
  // @ts-expect-error object fields use the same recursive check
  Expr.object({ nested: empty })
  // @ts-expect-error array elements use the same recursive check
  Expr.array(boxed)
  // @ts-expect-error nested arrays must not hide erased types
  Expr.lift({ nested: [object] })
  // @ts-expect-error an erased argument cannot be passed to a broad FFI parameter
  Expr.call(FFI.Value<(value: typeof object) => void>("consume"), object)
  // @ts-expect-error statement values use the same lift check
  Stmt.return(empty)
  Program.build(function*() {
    // @ts-expect-error function finals must reject erased values
    return yield* Decl.fn("invalid", {
      body: function*() {
        return empty
      },
    })
  })
  const arrow = Expr.arrow({
    body: function*() {
      return boxed
    },
  })
  // @ts-expect-error arrow finals must reject erased values
  Decl.const("invalid", arrow)
  Program.build(function*() {
    // @ts-expect-error an annotation cannot repair the stage-1 value's erased type
    return yield* Decl.const("invalid", empty, Type.object({}))
  })
}
void rejectErasedValues
