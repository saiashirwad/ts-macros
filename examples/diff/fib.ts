import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins recursion, early returns and calls in argument position: probe() must return 6765 on every target.
// Bodies materialize eagerly, so a self-call cannot use the yield* ref (the JS binding does not exist
// yet while the body drains) — it uses a name-based ref instead.
export const program = Program.build(function*() {
  const fibRef = $.Value<(n: number) => number>("fib")

  yield* $.Function("fib").pipe(
    $.Params($.Param("n", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ n }) {
      yield* $.If($.lt(n, $.Number(2)), function*() {
        yield* $.Return(n)
      })
      return $.add($.Call(fibRef, $.sub(n, $.Number(1))), $.Call(fibRef, $.sub(n, $.Number(2))))
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      return $.Call(fibRef, $.Number(20))
    }),
  )
})
