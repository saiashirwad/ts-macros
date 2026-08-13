import * as $ from "./$.ts"
import * as Binding from "./binding.ts"
import { emitProgram } from "./emit/index.ts"
import * as Expr from "./expr.ts"
import * as Fn from "./function.ts"
import * as Program from "./program.ts"
import * as Stmt from "./statement.ts"
import * as Type from "./types/index.ts"

export const program = Program.build(function*() {
  const total = yield* Binding.Let("total").pipe($.Init($.Number(0)))
  const arr = yield* Binding.Const("arr").pipe($.Init($.Array($.Number(1), $.Number(2), $.Number(3))))

  yield* $.ForOf("item", arr, function*(item) {
    const lol = yield* Binding.Const("lol").pipe($.Init($.Binary("+", total, item)))
    yield* $.Assign(total, lol)
  })

  yield* Stmt.While(Expr.Binary(">", total, Expr.Number(10)), function*() {
    yield* Expr.Assign(total, Expr.Binary("-", total, Expr.Number(1)))
  })
})

console.log(emitProgram(program))
