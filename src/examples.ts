import * as $ from "./$.ts"
import { Const, Let } from "./binding.ts"
import { emitProgram } from "./emit/index.ts"
import * as Program from "./program.ts"
import * as Type from "./types/index.ts"

export const program = Program.build(function*() {
  const Classify = yield* $.Function("classify").pipe(
    $.Params($.Param("score", Type.Number())),
    $.Impl(function*({ score }) {
      const grade = yield* Let("grade").pipe($.Init($.String("F")))
      yield* $.If($.Binary(">=", score, $.Number(90)), function*() {
        const curved = yield* Const("curved").pipe($.Init($.Binary("+", score, $.Number(5))))
        yield* $.If($.Binary(">", curved, $.Number(100)), function*() {
          yield* $.Assign(grade, $.String("A+"))
        }).pipe(
          $.Else(function*() {
            yield* $.Assign(grade, $.String("A"))
          }),
        )
      }).pipe(
        $.ElseIf($.Binary(">=", score, $.Number(80)), function*() {
          yield* $.Assign(grade, $.String("B"))
        }),
        $.ElseIf($.Binary(">=", score, $.Number(70)), function*() {
          yield* $.Assign(grade, $.String("C"))
        }),
      )
      return grade
    }),
  )

  const SumUntil = yield* $.Function("sumUntil").pipe(
    $.Params($.Param("limit", Type.Number())),
    $.Impl(function*({ limit }) {
      const total = yield* Let("total").pipe($.Init($.Number(0)))
      const current = yield* Let("current").pipe($.Init($.Number(1)))
      yield* $.While($.Boolean(true), function*() {
        const next = yield* Const("next").pipe($.Init($.Binary("+", total, current)))
        yield* $.If($.Binary(">", next, limit), function*() {
          yield* $.Break()
        })
        yield* $.Assign(total, next)
        yield* $.Assign(current, $.Binary("+", current, $.Number(1)))
      })
      return total
    }),
  )

  const FirstBig = yield* $.Function("firstBig").pipe(
    $.Params($.Param("numbers", Type.Array(Type.Number()))),
    $.Impl(function*({ numbers }) {
      const seen = yield* Let("seen").pipe($.Init($.Number(0)))
      yield* $.ForOf("n", numbers, function*(n) {
        const squared = yield* Const("squared").pipe($.Init($.Binary("*", n, n)))
        yield* $.Assign(seen, $.Binary("+", seen, $.Number(1)))
        yield* $.If($.Binary(">", squared, $.Number(100)), function*() {
          yield* $.Return(squared)
        })
      })
      return $.String("none")
    }),
  )

  const label = yield* Const("label").pipe($.Init($.Call(Classify, $.Number(93))))
  const total = yield* Const("total").pipe($.Init($.Call(SumUntil, $.Number(50))))
  const big = yield* Const("big").pipe(
    $.Init($.Call(FirstBig, $.Array($.Number(3), $.Number(11), $.Number(7)))),
  )

  return $.Object({ label, total, big })
})

console.log(emitProgram(program))
