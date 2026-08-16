import * as Binding from "../../src/binding.ts"
import * as Expr from "../../src/expr.ts"
import * as Fn from "../../src/function.ts"
import * as Program from "../../src/program.ts"
import * as Type from "../../src/types/index.ts"

// pins variable division semantics: probe() must return 12
export const program = Program.build(function*() {
  yield* Fn.Function("probe").pipe(
    Fn.Returns(Type.Number()),
    Fn.Impl(function*() {
      const a = yield* Binding.Const("a").pipe(Binding.Init(Expr.Number(144)))
      const b = yield* Binding.Const("b").pipe(Binding.Init(Expr.Number(12)))
      return Expr.Binary("/", a, b)
    }),
  )
})
