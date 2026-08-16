import * as Binding from "../../src/binding.ts"
import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Stmt from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

// pins early returns, nested whiles and boolean results feeding conditions: probe() must return 8 on every target
// (divisibility is simulated with subtraction — the IR has no modulo operator for double)
export const program = Program.build(function*() {
  const isPrime = yield* Fn.Function("isPrime").pipe(
    Fn.Params(Fn.Param("n", Type.Number())),
    Fn.Returns(Type.Boolean()),
    Fn.Impl(function*({ n }) {
      yield* Stmt.If(Expr.Binary("<", n, Expr.Number(2)), function*() {
        yield* Stmt.Return(Expr.Boolean(false))
      })
      const i = yield* Binding.Let("i").pipe(Binding.Init(Expr.Number(2)))
      yield* Stmt.While(Expr.Binary("<", i, n), function*() {
        const r = yield* Binding.Let("r").pipe(Binding.Init(n))
        yield* Stmt.While(Expr.Binary(">=", r, i), function*() {
          yield* Expr.Assign(r, Expr.Binary("-", r, i))
        })
        yield* Stmt.If(Expr.Binary("===", r, Expr.Number(0)), function*() {
          yield* Stmt.Return(Expr.Boolean(false))
        })
        yield* Expr.Assign(i, Expr.Binary("+", i, Expr.Number(1)))
      })
      return Expr.Boolean(true)
    }),
  )

  const countPrimes = yield* Fn.Function("countPrimes").pipe(
    Fn.Params(Fn.Param("upto", Type.Number())),
    Fn.Returns(Type.Number()),
    Fn.Impl(function*({ upto }) {
      const count = yield* Binding.Let("count").pipe(Binding.Init(Expr.Number(0)))
      const i = yield* Binding.Let("i").pipe(Binding.Init(Expr.Number(2)))
      yield* Stmt.While(Expr.Binary("<", i, upto), function*() {
        yield* Stmt.If(Fn.Call(isPrime, i), function*() {
          yield* Expr.Assign(count, Expr.Binary("+", count, Expr.Number(1)))
        })
        yield* Expr.Assign(i, Expr.Binary("+", i, Expr.Number(1)))
      })
      return count
    }),
  )

  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      return Fn.Call(countPrimes, Expr.Number(20))
    }),
  )
})
