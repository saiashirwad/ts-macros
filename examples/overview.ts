import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

export const program = Program.build(function*() {
  const Classify = yield* Stmt.fn("classify", {
    params: [Expr.param("score", Type.number)],
    body: function*({ score }) {
      const grade = yield* Binding.let_("grade", "F")
      yield* Stmt.if_(Expr.gte(score, 90), function*() {
        const curved = yield* Binding.const_("curved", Expr.add(score, 5))
        yield* Stmt.if_(Expr.gt(curved, 100), function*() {
          yield* Stmt.assign(grade, "A+")
        }).pipe(
          Stmt.else_(function*() {
            yield* Stmt.assign(grade, "A")
          }),
        )
      }).pipe(
        Stmt.elseIf(Expr.gte(score, 80), function*() {
          yield* Stmt.assign(grade, "B")
        }),
        Stmt.elseIf(Expr.gte(score, 70), function*() {
          yield* Stmt.assign(grade, "C")
        }),
      )
      return grade
    },
  })

  const SumUntil = yield* Stmt.fn("sumUntil", {
    params: [Expr.param("limit", Type.number)],
    body: function*({ limit }) {
      const total = yield* Binding.let_("total", 0)
      const current = yield* Binding.let_("current", 1)
      yield* Stmt.while_(true, function*() {
        const next = yield* Binding.const_("next", Expr.add(total, current))
        yield* Stmt.if_(Expr.gt(next, limit), function*() {
          yield* Stmt.break_()
        })
        yield* Stmt.assign(total, next)
        yield* Stmt.assign(current, Expr.add(current, 1))
      })
      return total
    },
  })

  const FirstBig = yield* Stmt.fn("firstBig", {
    params: [Expr.param("numbers", Type.array(Type.number))],
    body: function*({ numbers }) {
      const seen = yield* Binding.let_("seen", 0)
      yield* Stmt.forOf("n", numbers, function*(n) {
        const squared = yield* Binding.const_("squared", Expr.mul(n, n))
        yield* Stmt.assign(seen, Expr.add(seen, 1))
        yield* Stmt.if_(Expr.gt(squared, 100), function*() {
          yield* Stmt.return_(squared)
        })
      })
      return "none"
    },
  })

  const label = yield* Binding.const_("label", Expr.call(Classify, 93))
  const total = yield* Binding.const_("total", Expr.call(SumUntil, 50))
  const big = yield* Binding.const_("big", Expr.call(FirstBig, [3, 11, 7]))

  return { label, total, big }
})

console.log(emitProgram(program))
