import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = T.build(function*() {
  const total = yield* T.let("total", 0)
  const arr = yield* T.const("arr", [1, 2, 3])

  yield* T.forOf("item", arr, function*(item) {
    const lol = yield* T.const("lol", T.add(total, item))
    yield* T.assign(total, lol)
  })

  yield* T.while(T.gt(total, 10), function*() {
    yield* T.assign(total, T.sub(total, 1))
  })
})

console.log(emitProgram(program))
