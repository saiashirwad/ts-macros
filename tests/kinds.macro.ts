// One export of each kind of binding, for checking that what a consumer sees
// through `exports` is what tsc infers for the emitted module.

import { exports } from "../macro/index.ts"
import { Decl, Expr, FFI, Program, Type } from "../src/index.ts"

export const program = Program.build(function*() {
  const T = Type.param("T")
  const literal = yield* Decl.const_("literal", 1)
  const counter = yield* Decl.let_("counter", 1)
  const word = yield* Decl.const_("word", "a")
  const copy = yield* Decl.let_("copy", word)
  const point = yield* Decl.const_("point", Expr.object({ x: 1, y: Expr.array(literal, 2) }))
  const pick = yield* Decl.fn("pick", {
    params: [Expr.param("flag", Type.boolean)],
    body: function*({ flag }) {
      return Expr.cond(flag, Expr.object({ ok: true }), "no")
    },
  })
  const identity = yield* Decl.fn("identity", {
    typeParams: [T],
    params: [Expr.param("value", T)],
    returns: T,
    body: function*({ value }) {
      return value
    },
  })
  const scaled = yield* Decl.fn("scaled", {
    params: [Expr.param("n", Type.number)],
    body: function*({ n }) {
      return Expr.call(Expr.prop(FFI.Value<Math>("Math"), "max"), n, Expr.prop(point, "x"))
    },
  })
  return { literal, counter, word, copy, point, pick, scaled, identity }
})

const { identity: _identity, ...exact } = program.result
export const exportable = { ...program, result: exact }

// @ts-expect-error a generic function cannot be exported with its exact type
const _rejected = () => exports(program)

export const { literal, counter, word, copy, point, pick, scaled } = exports(exportable)
