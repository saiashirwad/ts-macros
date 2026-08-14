import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins while-loop accumulation and call results feeding arithmetic: probe() must return 362880 on every target
export const program = Program.build(function*() {
  const fact = yield* $.Function("fact").pipe(
    $.Params($.Param("n", Type.Number())),
    $.Returns(Type.Number()),
    $.Impl(function*({ n }) {
      const result = yield* $.Let("result", $.Number(1))
      const i = yield* $.Let("i", $.Number(1))
      yield* $.While($.lte(i, n), function*() {
        yield* $.Assign(result, $.mul(result, i))
        yield* $.Assign(i, $.add(i, $.Number(1)))
      })
      return result
    }),
  )

  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      return fact($.Number(9))
    }),
  )
})
