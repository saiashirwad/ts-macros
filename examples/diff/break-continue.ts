import * as Binding from "../../src/binding.ts"
import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Stmt from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

// pins break and continue inside while: probe() must return 37 on every target
export const program = Program.build(function*() {
  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      const sum = yield* Binding.Let("sum").pipe(Binding.Init(Expr.Number(0)))
      const i = yield* Binding.Let("i").pipe(Binding.Init(Expr.Number(0)))
      yield* Stmt.While(Expr.Binary("<", i, Expr.Number(12)), function*() {
        yield* Expr.Assign(i, Expr.Binary("+", i, Expr.Number(1)))
        yield* Stmt.If(
          Expr.Binary("||", Expr.Binary("===", i, Expr.Number(3)), Expr.Binary("===", i, Expr.Number(5))),
          function*() {
            yield* Stmt.Continue()
          },
        )
        yield* Expr.Assign(sum, Expr.Binary("+", sum, i))
        yield* Stmt.If(Expr.Binary(">", sum, Expr.Number(30)), function*() {
          yield* Stmt.Break()
        })
      })
      return sum
    }),
  )
})
