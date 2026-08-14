import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins numeric comparisons, boolean logic, boolean bindings and params: probe() must return 11 on every target
export const program = Program.build(function*() {
  const bump = yield* $.Function("bump").pipe(
    $.Params($.Param("x", Type.Number()), $.Param("flag", Type.Boolean())),
    $.Returns(Type.Number()),
    $.Impl(function*({ x, flag }) {
      yield* $.If(flag, function*() {
        yield* $.Return($.add(x, $.Number(1)))
      })
      return $.sub(x, $.Number(1))
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      const a = yield* $.Const("a", $.Number(3))
      const b = yield* $.Const("b", $.Number(7))
      const c = yield* $.Const("c", $.Number(3))
      const count = yield* $.Let("count", $.Number(0))
      yield* $.If($.eq(a, c), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.neq(a, b), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.lt(a, b), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.gt(b, a), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.lte(a, c), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.gte(b, a), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.and($.lt(a, b), $.lt(b, $.Number(10))), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.not($.gt(a, b)), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      yield* $.If($.or($.gt(a, b), $.lt(a, b)), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      const flag = yield* $.Const("flag", $.lt(a, b))
      yield* $.If($.and(flag, $.gt(b, a)), function*() {
        yield* $.Assign(count, $.add(count, $.Number(1)))
      })
      return bump(count, flag)
    }),
  )
})
