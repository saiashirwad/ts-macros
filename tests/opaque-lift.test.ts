// oxlint-disable typescript/no-wrapper-object-types -- These tests specifically verify rejection of Object.
import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"
import type { Equal } from "./typing.ts"

test("erased object types have clear recursive lift diagnostics", () => {
  const empty: Equal<Expr.CheckLift<{}>, ["cannot lift a value typed", {}]> = true
  const object: Equal<Expr.CheckLift<object>, ["cannot lift a value typed", object]> = true
  const boxed: Equal<Expr.CheckLift<Object>, ["cannot lift a value typed", Object]> = true
  const nested: Equal<Expr.CheckLift<{ values: readonly { child: object }[] }>, ["cannot lift a value typed", object]> = true
  const optional: Equal<Expr.CheckLift<{ child?: {} }>, ["cannot lift a value typed", {}]> = true
  const union: Equal<Expr.CheckLift<string | Object>, ["cannot lift a value typed", Object]> = true
  type Tree = { children: Tree[]; value: {} }
  const recursive: Equal<Expr.CheckLift<Tree>, ["cannot lift a value typed", {}]> = true
  const noLift: Equal<Expr.Lift<{} | object | Object>, never> = true
  assert.equal(empty && object && boxed && nested && optional && union && recursive && noLift, true)
})

test("explicit empty object nodes lift and emit normally", () => {
  const empty = Expr.object({})
  assert.equal(Expr.lift(empty), empty)
  assert.equal(Expr.lift({ nested: empty }).kind, "object")
  assert.equal(Expr.array(empty).kind, "array")
  const program = Program.build(function*() {
    return yield* Decl.const_("actual", empty)
  })
  assert.equal(emitProgram(program), "const actual = {};")
  const external = FFI.Value<object>("external")
  assert.equal(Expr.lift(external), external)
  // A described plain value remains valid even when the stage-2 parameter is broad.
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
  Stmt.return_(empty)
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
  Decl.const_("invalid", arrow)
  Program.build(function*() {
    // @ts-expect-error an annotation cannot repair the stage-1 value's erased type
    return yield* Decl.const_("invalid", empty, Type.object({}))
  })
}
void rejectErasedValues
