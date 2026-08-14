import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins break and continue inside while: probe() must return 37 on every target
export const program = Program.build(function*() {
  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      const sum = yield* $.Let("sum", $.Number(0))
      const i = yield* $.Let("i", $.Number(0))
      yield* $.While($.lt(i, $.Number(12)), function*() {
        yield* $.Assign(i, $.add(i, $.Number(1)))
        yield* $.If($.or($.eq(i, $.Number(3)), $.eq(i, $.Number(5))), function*() {
          yield* $.Continue()
        })
        yield* $.Assign(sum, $.add(sum, i))
        yield* $.If($.gt(sum, $.Number(30)), function*() {
          yield* $.Break()
        })
      })
      return sum
    }),
  )
})
