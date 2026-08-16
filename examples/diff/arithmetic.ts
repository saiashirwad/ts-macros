import * as Binding from "../../src/binding.ts"
import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins operator precedence and parentheses: probe() must return 40 on every target
export const program = Program.build(function*() {
  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      const a = yield* Binding.Const("a").pipe(
        Binding.Init(Expr.Binary("+", Expr.Number(1), Expr.Binary("*", Expr.Number(2), Expr.Number(3)))),
      )
      const b = yield* Binding.Const("b").pipe(
        Binding.Init(Expr.Binary("*", Expr.Binary("+", Expr.Number(1), Expr.Number(2)), Expr.Number(3))),
      )
      const c = yield* Binding.Const("c").pipe(
        Binding.Init(
          Expr.Binary(
            "*",
            Expr.Binary("-", Expr.Binary("-", Expr.Number(10), Expr.Number(2)), Expr.Number(3)),
            Expr.Binary("+", Expr.Number(4), Expr.Number(1)),
          ),
        ),
      )
      return Expr.Binary("-", Expr.Binary("+", Expr.Binary("+", a, b), c), Expr.Number(1))
    }),
  )
})
