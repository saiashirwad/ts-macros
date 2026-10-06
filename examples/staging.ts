import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

function power(x: $.In<number>, n: number): $.Expr<number> {
  let result: $.Expr<number> = $.number(1)
  for (let i = 0; i < n; i++) result = $.mul(result, x)
  return result
}

function* savedPower(x: $.In<number>, n: number) {
  return yield* $.const("tmp", power(x, n))
}

export const program = $.build(function*() {
  return yield* $.fn("polynomial", {
    params: [$.param("x", $.Number)],
    body: function*({ x }) {
      const cube = yield* savedPower(x, 3)
      const square = yield* savedPower(x, 2)
      return $.add(cube, square)
    },
  })
})

console.log(emitProgram(program))
