import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

export const program = Program.build(function*() {
  const Classify = yield* Fn.Function("classify").pipe(
    Fn.Params(Fn.Param("score", Type.Number())),
    Fn.Impl(function*({ score }) {
      const grade = yield* Binding.Let("grade").pipe(Binding.Init(Expr.String("F")))
      yield* Stmt.If(Expr.Binary(">=", score, Expr.Number(90)), function*() {
        const curved = yield* Binding.Const("curved").pipe(Binding.Init(Expr.Binary("+", score, Expr.Number(5))))
        yield* Stmt.If(Expr.Binary(">", curved, Expr.Number(100)), function*() {
          yield* Stmt.Assign(grade, Expr.String("A+"))
        }).pipe(
          Stmt.Else(function*() {
            yield* Stmt.Assign(grade, Expr.String("A"))
          }),
        )
      }).pipe(
        Stmt.ElseIf(Expr.Binary(">=", score, Expr.Number(80)), function*() {
          yield* Stmt.Assign(grade, Expr.String("B"))
        }),
        Stmt.ElseIf(Expr.Binary(">=", score, Expr.Number(70)), function*() {
          yield* Stmt.Assign(grade, Expr.String("C"))
        }),
      )
      return grade
    }),
  )

  const SumUntil = yield* Fn.Function("sumUntil").pipe(
    Fn.Params(Fn.Param("limit", Type.Number())),
    Fn.Impl(function*({ limit }) {
      const total = yield* Binding.Let("total").pipe(Binding.Init(Expr.Number(0)))
      const current = yield* Binding.Let("current").pipe(Binding.Init(Expr.Number(1)))
      yield* Stmt.While(Expr.Boolean(true), function*() {
        const next = yield* Binding.Const("next").pipe(Binding.Init(Expr.Binary("+", total, current)))
        yield* Stmt.If(Expr.Binary(">", next, limit), function*() {
          yield* Stmt.Break()
        })
        yield* Stmt.Assign(total, next)
        yield* Stmt.Assign(current, Expr.Binary("+", current, Expr.Number(1)))
      })
      return total
    }),
  )

  const FirstBig = yield* Fn.Function("firstBig").pipe(
    Fn.Params(Fn.Param("numbers", Type.Array(Type.Number()))),
    Fn.Impl(function*({ numbers }) {
      const seen = yield* Binding.Let("seen").pipe(Binding.Init(Expr.Number(0)))
      yield* Stmt.ForOf("n", numbers, function*(n) {
        const squared = yield* Binding.Const("squared").pipe(Binding.Init(Expr.Binary("*", n, n)))
        yield* Stmt.Assign(seen, Expr.Binary("+", seen, Expr.Number(1)))
        yield* Stmt.If(Expr.Binary(">", squared, Expr.Number(100)), function*() {
          yield* Stmt.Return(squared)
        })
      })
      return Expr.String("none")
    }),
  )

  const label = yield* Binding.Const("label").pipe(Binding.Init(Fn.Call(Classify, Expr.Number(93))))
  const total = yield* Binding.Const("total").pipe(Binding.Init(Fn.Call(SumUntil, Expr.Number(50))))
  const big = yield* Binding.Const("big").pipe(
    Binding.Init(Fn.Call(FirstBig, Expr.Array(Expr.Number(3), Expr.Number(11), Expr.Number(7)))),
  )

  return Expr.Object({ label, total, big })
})

console.log(emitProgram(program))
