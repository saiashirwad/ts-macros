import * as Binding from "../../src/binding.ts"
import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins literal division: 7 / 2 must evaluate to 3.5 in both TS and C (7.0 / 2.0 in C)
export const program = Program.build(function*() {
  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      const a = yield* Binding.Const("a").pipe(Binding.Init(Expr.Binary("/", Expr.Number(7), Expr.Number(2))))
      const b = yield* Binding.Const("b").pipe(Binding.Init(Expr.Binary("/", Expr.Number(1), Expr.Number(4))))
      return Expr.Binary("+", a, b)
    }),
  )
})
