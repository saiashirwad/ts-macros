import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Stmt from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

// pins self-recursion: probe() must return 6765 (fib(20))
export const program = Program.build(function*() {
  const fib: Fn.FunctionRef<[Fn.Param<"n", number>], number> = yield* Fn.Function("fib").pipe(
    Fn.Params(Fn.Param("n", Type.Number())),
    Fn.Returns(Type.Number()),
    Fn.Impl(function*({ n }) {
      yield* Stmt.If(Expr.Binary("<=", n, Expr.Number(1)), function*() {
        yield* Stmt.Return(n)
      })
      return Expr.Binary(
        "+",
        Fn.Call(fib, Expr.Binary("-", n, Expr.Number(1))),
        Fn.Call(fib, Expr.Binary("-", n, Expr.Number(2))),
      )
    }),
  )

  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      return Fn.Call(fib, Expr.Number(20))
    }),
  )
})
