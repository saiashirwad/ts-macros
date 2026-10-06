import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

function power(x: T.In<number>, n: number): T.Expr<number> {
  let result: T.Expr<number> = T.numberLiteral(1)
  for (let i = 0; i < n; i++) result = T.mul(result, x)
  return result
}

function* savedPower(x: T.In<number>, n: number) {
  return yield* T.const("tmp", power(x, n))
}

export const program = T.build(function*() {
  return yield* T.fn("polynomial", {
    params: [T.param("x", T.Number)],
    body: function*({ x }) {
      const cube = yield* savedPower(x, 3)
      const square = yield* savedPower(x, 2)
      return T.add(cube, square)
    },
  })
})

console.log(emitProgram(program))
