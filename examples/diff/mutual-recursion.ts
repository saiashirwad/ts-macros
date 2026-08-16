import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Stmt from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

// pins mutual recursion and prototype hoisting: probe() must return 10
export const program = Program.build(function*() {
  const countEven: Fn.FunctionRef<[Fn.Param<"n", number>], number> = yield* Fn.Function("countEven").pipe(
    Fn.Params(Fn.Param("n", Type.Number())),
    Fn.Returns(Type.Number()),
    Fn.Impl(function*({ n }) {
      yield* Stmt.If(Expr.Binary("<=", n, Expr.Number(0)), function*() {
        yield* Stmt.Return(Expr.Number(0))
      })
      return Expr.Binary("+", Expr.Number(1), Fn.Call(countOdd, Expr.Binary("-", n, Expr.Number(1))))
    }),
  )

  const countOdd: Fn.FunctionRef<[Fn.Param<"n", number>], number> = yield* Fn.Function("countOdd").pipe(
    Fn.Params(Fn.Param("n", Type.Number())),
    Fn.Returns(Type.Number()),
    Fn.Impl(function*({ n }) {
      yield* Stmt.If(Expr.Binary("<=", n, Expr.Number(0)), function*() {
        yield* Stmt.Return(Expr.Number(0))
      })
      return Expr.Binary("+", Expr.Number(1), Fn.Call(countEven, Expr.Binary("-", n, Expr.Number(1))))
    }),
  )

  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      return Fn.Call(countEven, Expr.Number(10))
    }),
  )
})
