import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import { emitProgram } from "../targets/typescript/index.ts"

export const program = Program.build(function*() {
  const total = yield* Binding.let_("total", 0)
  const arr = yield* Binding.const_("arr", [1, 2, 3])

  yield* Stmt.forOf("item", arr, function*(item) {
    const lol = yield* Binding.const_("lol", Expr.add(total, item))
    yield* Stmt.assign(total, lol)
  })

  yield* Stmt.while_(Expr.gt(total, 10), function*() {
    yield* Stmt.assign(total, Expr.sub(total, 1))
  })
})

console.log(emitProgram(program))
