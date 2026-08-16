import * as Binding from "../../src/binding.ts"
import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Stmt from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

// pins while loop and multiplication: probe() must return 362880 (10!)
export const program = Program.build(function*() {
  const fact = yield* Fn.Function("fact").pipe(
    Fn.Params(Fn.Param("n", Type.Number())),
    Fn.Returns(Type.Number()),
    Fn.Impl(function*({ n }) {
      const acc = yield* Binding.Let("acc").pipe(Binding.Init(Expr.Number(1)))
      const i = yield* Binding.Let("i").pipe(Binding.Init(Expr.Number(1)))
      yield* Stmt.While(Expr.Binary("<=", i, n), function*() {
        yield* Expr.Assign(acc, Expr.Binary("*", acc, i))
        yield* Expr.Assign(i, Expr.Binary("+", i, Expr.Number(1)))
      })
      return acc
    }),
  )

  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      return Fn.Call(fact, Expr.Number(9))
    }),
  )
})
