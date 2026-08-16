import * as Binding from "../../src/binding.ts"
import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Stmt from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"

// pins if-else chain semantics: probe() must return 14 on every target
export const program = Program.build(function*() {
  const classify = yield* Fn.Function("classify").pipe(
    Fn.Params(Fn.Param("n", Type.Number())),
    Fn.Returns(Type.Number()),
    Fn.Impl(function*({ n }) {
      const res = yield* Binding.Let("res").pipe(Binding.Init(Expr.Number(0)))
      yield* Stmt.If(Expr.Binary("<", n, Expr.Number(0)), function*() {
        yield* Expr.Assign(res, Expr.Number(1))
      }).pipe(
        Stmt.ElseIf(Expr.Binary("===", n, Expr.Number(0)), function*() {
          yield* Expr.Assign(res, Expr.Number(2))
        }),
        Stmt.ElseIf(Expr.Binary("<", n, Expr.Number(10)), function*() {
          yield* Expr.Assign(res, Expr.Number(3))
        }),
        Stmt.Else(function*() {
          yield* Expr.Assign(res, Expr.Number(4))
        }),
      )
      return res
    }),
  )

  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      const a = yield* Binding.Const("a").pipe(Binding.Init(Fn.Call(classify, Expr.Number(-5))))
      const b = yield* Binding.Const("b").pipe(Binding.Init(Fn.Call(classify, Expr.Number(0))))
      const c = yield* Binding.Const("c").pipe(Binding.Init(Fn.Call(classify, Expr.Number(7))))
      const d = yield* Binding.Const("d").pipe(Binding.Init(Fn.Call(classify, Expr.Number(42))))
      return Expr.Binary(
        "+",
        Expr.Binary("+", Expr.Binary("*", a, Expr.Number(1)), Expr.Binary("*", b, Expr.Number(2))),
        Expr.Binary("+", Expr.Binary("*", c, Expr.Number(1)), Expr.Binary("*", d, Expr.Number(1.5))),
      )
    }),
  )
})
