import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import { emitProgram } from "../targets/babel/index.ts"

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
  // const Identity = yield* Fn.Function("identity").pipe(
  //   Fn.TypeParams(IdentityT),
  //   Fn.Params(Fn.Param("value", IdentityT)),
  //   Fn.Impl(function*({ value }) {
  //     return value
  //   }),
  // )
  //
  // const NumberIdentity = Fn.Instantiate(Identity, Type.Number())
  //
  // const value = yield* Binding.Const("value").pipe(Binding.Init(Fn.Call(NumberIdentity, Expr.Number(42))))
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

  const total = yield* Binding.Let("total").pipe(Binding.Init(Expr.Number(0)))
  const arr = yield* Binding.Const("arr").pipe(Binding.Init(Expr.Array(Expr.Number(1), Expr.Number(2), Expr.Number(3))))

  yield* Stmt.ForOf("item", arr, function*(item) {
    const lol = yield* Binding.Const("lol").pipe(Binding.Init(Expr.Binary("+", total, item)))
    yield* Expr.Assign(total, lol)
  })

  yield* Stmt.While(Expr.Binary(">", total, Expr.Number(10)), function*() {
    yield* Expr.Assign(total, Expr.Binary("-", total, Expr.Number(1)))
  })
})

console.log(emitProgram(program))
