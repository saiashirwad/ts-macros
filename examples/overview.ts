import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = $.build(function*() {
  const Classify = yield* $.fn("classify", {
    params: [$.param("score", $.Number)],
    body: function*({ score }) {
      const grade = yield* $.let("grade", "F")
      yield* $.if($.gte(score, 90), function*() {
        const curved = yield* $.const("curved", $.add(score, 5))
        yield* $.if($.gt(curved, 100), function*() {
          yield* $.assign(grade, "A+")
        }).pipe(
          $.else(function*() {
            yield* $.assign(grade, "A")
          }),
        )
      }).pipe(
        $.elseIf($.gte(score, 80), function*() {
          yield* $.assign(grade, "B")
        }),
        $.elseIf($.gte(score, 70), function*() {
          yield* $.assign(grade, "C")
        }),
      )
      return grade
    },
  })

  const SumUntil = yield* $.fn("sumUntil", {
    params: [$.param("limit", $.Number)],
    body: function*({ limit }) {
      const total = yield* $.let("total", 0)
      const current = yield* $.let("current", 1)
      yield* $.while(true, function*() {
        const next = yield* $.const("next", $.add(total, current))
        yield* $.if($.gt(next, limit), function*() {
          yield* $.break()
        })
        yield* $.assign(total, next)
        yield* $.assign(current, $.add(current, 1))
      })
      return total
    },
  })

  const FirstBig = yield* $.fn("firstBig", {
    params: [$.param("numbers", $.Array($.Number))],
    body: function*({ numbers }) {
      const seen = yield* $.let("seen", 0)
      yield* $.forOf("n", numbers, function*(n) {
        const squared = yield* $.const("squared", $.mul(n, n))
        yield* $.assign(seen, $.add(seen, 1))
        yield* $.if($.gt(squared, 100), function*() {
          yield* $.return(squared)
        })
      })
      return "none"
    },
  })

  const label = yield* $.const("label", $.call(Classify, 93))
  const total = yield* $.const("total", $.call(SumUntil, 50))
  const big = yield* $.const("big", $.call(FirstBig, [3, 11, 7]))

  return { label, total, big }
})

console.log(emitProgram(program))
