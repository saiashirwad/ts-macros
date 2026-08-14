import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins if/elseif/else chains inside a counted while loop: probe() must return 14 on every target
export const program = Program.build(function*() {
  const classify = yield* $.Function("classify").pipe(
    $.Params($.Param("n", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ n }) {
      const result = yield* $.Let("result", $.Number(0))
      yield* $.If($.lt(n, $.Number(10)), function*() {
        yield* $.Assign(result, $.Number(1))
      }).elseif($.lt(n, $.Number(100)), function*() {
        yield* $.Assign(result, $.Number(2))
      }).else(function*() {
        yield* $.Assign(result, $.Number(3))
      })
      return result
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      const total = yield* $.Let("total", $.Number(0))
      const i = yield* $.Let("i", $.Number(0))
      yield* $.While($.lt(i, $.Number(12)), function*() {
        yield* $.Assign(total, $.add(total, classify(i)))
        yield* $.Assign(i, $.add(i, $.Number(1)))
      })
      return total
    }),
  )
})
