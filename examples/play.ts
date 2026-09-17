import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import { emitProgram } from "../targets/typescript/index.ts"

export const program = Program.build(function*() {
  const total = yield* Binding.Let("total").pipe(Binding.Init(Expr.Number(0)))
  const arr = yield* Binding.Const("arr").pipe(Binding.Init(Expr.Array(Expr.Number(1), Expr.Number(2), Expr.Number(3))))

  yield* Stmt.ForOf("item", arr, function*(item) {
    const lol = yield* Binding.Const("lol").pipe(Binding.Init(Expr.Binary("+", total, item)))
    yield* Stmt.Assign(total, lol)
  })

  yield* Stmt.While(Expr.Binary(">", total, Expr.Number(10)), function*() {
    yield* Stmt.Assign(total, Expr.Binary("-", total, Expr.Number(1)))
  })
})

console.log(emitProgram(program))
