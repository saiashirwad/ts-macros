import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

interface Source {
  read(): string
  score: number
  scale(value: number): number
}

export const program = $.build(function*() {
  const source = $.hostValue<Source>("source")
  const raw = $.call($.prop(source, "read"))
  const decorated = yield* $.const("decorated", $.add(raw, "!"))

  const classify = yield* $.fn("classify", {
    params: [$.param("score", $.Number)],
    body: function*({ score }) {
      yield* $.if($.gte(score, 90), function*() {
        yield* $.return("A")
      }).pipe(
        $.elseIf($.gte(score, 60), function*() {
          yield* $.return("B")
        }),
      )
      return "C"
    },
  })

  const scale = $.prop(source, "scale")
  const label = yield* $.const("label", $.call(classify, $.call(scale, 4)))
  const values = yield* $.const("values", [1, 2, 3])
  const total = yield* $.let("total", 0)

  yield* $.forOf("value", values, function*(value) {
    const doubled = yield* $.const("doubled", $.mul(value, 2))
    yield* $.assign(total, $.add(total, doubled))
  })

  return $.lift({ decorated, label, total })
})

console.log(emitProgram(program))
