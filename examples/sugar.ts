import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

interface Source {
  read(): string
  score: number
  scale(value: number): number
}

export const program = T.build(function*() {
  const source = T.hostValue<Source>("source")
  const raw = T.call(T.prop(source, "read"))
  const decorated = yield* T.const("decorated", T.add(raw, "!"))

  const classify = yield* T.fn("classify", {
    params: [T.param("score", T.Number)],
    body: function*({ score }) {
      yield* T.if(T.gte(score, 90), function*() {
        yield* T.return("A")
      }).pipe(
        T.elseIf(T.gte(score, 60), function*() {
          yield* T.return("B")
        }),
      )
      return "C"
    },
  })

  const scale = T.prop(source, "scale")
  const label = yield* T.const("label", T.call(classify, T.call(scale, 4)))
  const values = yield* T.const("values", [1, 2, 3])
  const total = yield* T.let("total", 0)

  yield* T.forOf("value", values, function*(value) {
    const doubled = yield* T.const("doubled", T.mul(value, 2))
    yield* T.assign(total, T.add(total, doubled))
  })

  return T.lift({ decorated, label, total })
})

console.log(emitProgram(program))
