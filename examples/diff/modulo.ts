import * as Binding from "../../src/binding.ts"
import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"
import { int } from "../../targets/c/index.ts"

// pins integer % operator on both TS and C (probe() must return 4)
export const program = Program.build(function*() {
  const modTest = yield* Fn.Function("modTest").pipe(
    Fn.Params(Fn.Param("a", int()), Fn.Param("b", int())),
    Fn.Returns(int()),
    Fn.Impl(function*({ a, b }) {
      return Expr.Binary("%", a, b)
    }),
  )

  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      const x = yield* Binding.Const("x").pipe(Binding.Init(Fn.Call(modTest, Expr.Number(19), Expr.Number(5))))
      return x
    }),
  )
})
