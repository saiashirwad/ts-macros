import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Stmt from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

// pins reassigned params and if/else inside while: probe() must return 21 on every target
export const program = Program.build(function*() {
  const gcd = yield* Fn.Function("gcd").pipe(
    Fn.Params(Fn.Param("a", Type.Number()), Fn.Param("b", Type.Number())),
    Fn.Returns(Type.Number()),
    Fn.Impl(function*({ a, b }) {
      yield* Stmt.While(Expr.Binary("!==", a, b), function*() {
        yield* Stmt.If(Expr.Binary(">", a, b), function*() {
          yield* Expr.Assign(a, Expr.Binary("-", a, b))
        }).pipe(Stmt.Else(function*() {
          yield* Expr.Assign(b, Expr.Binary("-", b, a))
        }))
      })
      return a
    }),
  )

  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      return Fn.Call(gcd, Expr.Number(252), Expr.Number(105))
    }),
  )
})
