import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = $.build(function*() {
  const double = yield* $.fn("double", {
    params: [$.param("x", $.Number)],
    body: function*({ x }) {
      return $.mul(x, 2)
    },
  })

  // $.call(double, "21") // Type error in stage 1.
  yield* $.const("answer", $.call(double, 21))
})

console.log(emitProgram(program))
