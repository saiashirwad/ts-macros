import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = $.build(function*() {
  const total = yield* $.let("total", 0)
  const arr = yield* $.const("arr", [1, 2, 3])

  yield* $.forOf("item", arr, function*(item) {
    const lol = yield* $.const("lol", $.add(total, item))
    yield* $.assign(total, lol)
  })

  yield* $.while($.gt(total, 10), function*() {
    yield* $.assign(total, $.sub(total, 1))
  })
})

console.log(emitProgram(program))
