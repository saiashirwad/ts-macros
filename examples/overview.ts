import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = Program.build(function*() {
  const Classify = yield* Decl.fn("classify", {
    params: [Expr.param("score", Type.number)],
    body: function*({ score }) {
      const grade = yield* Decl.let("grade", "F")
      yield* Stmt.if(Expr.gte(score, 90), function*() {
        const curved = yield* Decl.const("curved", Expr.add(score, 5))
        yield* Stmt.if(Expr.gt(curved, 100), function*() {
          yield* Stmt.assign(grade, "A+")
        }).pipe(
          Stmt.else(function*() {
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

  const SumUntil = yield* Decl.fn("sumUntil", {
    params: [Expr.param("limit", Type.number)],
    body: function*({ limit }) {
      const total = yield* Decl.let("total", 0)
      const current = yield* Decl.let("current", 1)
      yield* Stmt.while(true, function*() {
        const next = yield* Decl.const("next", Expr.add(total, current))
        yield* Stmt.if(Expr.gt(next, limit), function*() {
          yield* Stmt.break()
        })
        yield* Stmt.assign(total, next)
        yield* Stmt.assign(current, Expr.add(current, 1))
      })
      return total
    },
  })

  const FirstBig = yield* Decl.fn("firstBig", {
    params: [Expr.param("numbers", Type.array(Type.number))],
    body: function*({ numbers }) {
      const seen = yield* Decl.let("seen", 0)
      yield* Stmt.forOf("n", numbers, function*(n) {
        const squared = yield* Decl.const("squared", Expr.mul(n, n))
        yield* Stmt.assign(seen, Expr.add(seen, 1))
        yield* Stmt.if(Expr.gt(squared, 100), function*() {
          yield* Stmt.return(squared)
        })
      })
      return "none"
    },
  })

  const label = yield* Decl.const("label", Expr.call(Classify, 93))
  const total = yield* Decl.const("total", Expr.call(SumUntil, 50))
  const big = yield* Decl.const("big", Expr.call(FirstBig, [3, 11, 7]))

  return { label, total, big }
})

console.log(emitProgram(program))
