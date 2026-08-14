import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins reassigned params and if/else inside while: probe() must return 21 on every target
export const program = Program.build(function*() {
  const gcd = yield* $.Function("gcd").pipe(
    $.Params($.Param("a", Type.Number()), $.Param("b", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ a, b }) {
      yield* $.While($.neq(a, b), function*() {
        yield* $.If($.gt(a, b), function*() {
          yield* $.Assign(a, $.sub(a, b))
        }).else(function*() {
          yield* $.Assign(b, $.sub(b, a))
        })
      })
      return a
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      return gcd($.Number(252), $.Number(105))
    }),
  )
})
