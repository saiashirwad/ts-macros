import * as Binding from "../../src/binding.ts"
import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Stmt from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

// pins comparison operators and boolean logic: probe() must return 11
export const program = Program.build(function*() {
  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      const score = yield* Binding.Let("score").pipe(Binding.Init(Expr.Number(0)))
      yield* Stmt.If(Expr.Binary("<", Expr.Number(3), Expr.Number(5)), function*() {
        yield* Expr.Assign(score, Expr.Binary("+", score, Expr.Number(1)))
      })
      yield* Stmt.If(Expr.Binary("<=", Expr.Number(5), Expr.Number(5)), function*() {
        yield* Expr.Assign(score, Expr.Binary("+", score, Expr.Number(2)))
      })
      yield* Stmt.If(Expr.Binary(">", Expr.Number(7), Expr.Number(4)), function*() {
        yield* Expr.Assign(score, Expr.Binary("+", score, Expr.Number(3)))
      })
      yield* Stmt.If(Expr.Binary(">=", Expr.Number(7), Expr.Number(7)), function*() {
        yield* Expr.Assign(score, Expr.Binary("+", score, Expr.Number(5)))
      })
      return score
    }),
  )
})
