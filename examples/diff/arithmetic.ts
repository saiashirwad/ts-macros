import * as $ from "../../src/$.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins operator precedence and parentheses: probe() must return 40 on every target
export const program = Program.build(function*() {
  yield* $.Function("probe").pipe(
    $.Returns(Type.Number()),
    $.Impl(function*() {
      const a = yield* $.Const("a", $.add($.Number(1), $.mul($.Number(2), $.Number(3))))
      const b = yield* $.Const("b", $.mul($.add($.Number(1), $.Number(2)), $.Number(3)))
      const c = yield* $.Const("c", $.mul($.sub($.sub($.Number(10), $.Number(2)), $.Number(3)), $.add($.Number(4), $.Number(1))))
      return $.sub($.add($.add(a, b), c), $.Number(1))
    }),
  )
})
