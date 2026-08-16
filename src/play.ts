import { emitProgram } from "../targets/typescript/index.ts"
import * as $ from "./$.ts"
import * as Binding from "./binding.ts"
import * as Expr from "./expr.ts"
import * as Fn from "./function.ts"
import * as Program from "./program.ts"
import * as Stmt from "./statement.ts"
import * as Type from "./types/index.ts"

export const program = Program.build(function*() {
  // const T = Type.Param("T")
  // const E = Type.Param("E")
  //
  // const Result = yield* Type.Type("Result").pipe(
  //   Type.TypeParams(T, E),
  //   Type.Body(
  //     Type.Union(
  //       Type.Object({ tag: Type.Literal("Ok"), value: T }),
  //       Type.Object({ tag: Type.Literal("Err"), error: E }),
  //     ),
  //   ),
  // )
  //
  // const IdentityT = Type.Param("T")
  // const Identity = yield* $.Function("identity").pipe(
  //   $.TypeParams(IdentityT),
  //   $.Params($.Param("value", IdentityT)),
  //   $.Impl(function*({ value }) {
  //     return value
  //   }),
  // )
  //
  // const NumberIdentity = $.Instantiate(Identity, Type.Number())
  //
  // const value = yield* $.Const("value").pipe($.Init($.Call(NumberIdentity, $.Number(42))))
  //
  // const Absolute = yield* Fn.Function("absolute").pipe(
  //   Fn.Params(Fn.Param("n", Type.Number())),
  //   Fn.Impl(function*({ n }) {
  //     yield* Stmt.If(Expr.Binary("<", n, value), function*() {
  //       yield* Stmt.Return(Expr.Binary("*", n, Expr.Number(-1)))
  //     })
  //     return n
  //   }),
  // )

  const total = yield* $.Let("total").pipe($.Init($.Number(0)))
  const arr = yield* $.Const("arr").pipe($.Init($.Array($.Number(1), $.Number(2), $.Number(3))))

  yield* $.ForOf("item", arr, function*(item) {
    const lol = yield* $.Const("lol").pipe($.Init($.Binary("+", total, item)))
    yield* $.Assign(total, lol)
  })

  yield* Stmt.While(Expr.Binary(">", total, Expr.Number(10)), function*() {
    yield* Expr.Assign(total, Expr.Binary("-", total, Expr.Number(1)))
  })
})

console.log(emitProgram(program))
