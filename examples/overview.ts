import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = T.build(function*() {
  const Classify = yield* T.fn("classify", {
    params: [T.param("score", T.Number)],
    body: function*({ score }) {
      const grade = yield* T.let("grade", "F")
      yield* T.if(T.gte(score, 90), function*() {
        const curved = yield* T.const("curved", T.add(score, 5))
        yield* T.if(T.gt(curved, 100), function*() {
          yield* T.assign(grade, "A+")
        }).pipe(
          T.else(function*() {
            yield* T.assign(grade, "A")
          }),
        )
      }).pipe(
        T.elseIf(T.gte(score, 80), function*() {
          yield* T.assign(grade, "B")
        }),
        T.elseIf(T.gte(score, 70), function*() {
          yield* T.assign(grade, "C")
        }),
      )
      return grade
    },
  })

  const SumUntil = yield* T.fn("sumUntil", {
    params: [T.param("limit", T.Number)],
    body: function*({ limit }) {
      const total = yield* T.let("total", 0)
      const current = yield* T.let("current", 1)
      yield* T.while(true, function*() {
        const next = yield* T.const("next", T.add(total, current))
        yield* T.if(T.gt(next, limit), function*() {
          yield* T.break()
        })
        yield* T.assign(total, next)
        yield* T.assign(current, T.add(current, 1))
      })
      return total
    },
  })

  const FirstBig = yield* T.fn("firstBig", {
    params: [T.param("numbers", T.Array(T.Number))],
    body: function*({ numbers }) {
      const seen = yield* T.let("seen", 0)
      yield* T.forOf("n", numbers, function*(n) {
        const squared = yield* T.const("squared", T.mul(n, n))
        yield* T.assign(seen, T.add(seen, 1))
        yield* T.if(T.gt(squared, 100), function*() {
          yield* T.return(squared)
        })
      })
      return "none"
    },
  })

  const label = yield* T.const("label", T.call(Classify, 93))
  const total = yield* T.const("total", T.call(SumUntil, 50))
  const big = yield* T.const("big", T.call(FirstBig, [3, 11, 7]))

  return { label, total, big }
})

console.log(emitProgram(program))
