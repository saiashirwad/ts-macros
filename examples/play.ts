import { Decl, Expr, Program, Stmt } from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = Program.build(function*() {
  const total = yield* Decl.let("total", 0)
  const arr = yield* Decl.const("arr", [1, 2, 3])

  yield* Stmt.forOf("item", arr, function*(item) {
    const lol = yield* Decl.const("lol", Expr.add(total, item))
    yield* Stmt.assign(total, lol)
  })

  yield* Stmt.while(Expr.gt(total, 10), function*() {
    yield* Stmt.assign(total, Expr.sub(total, 1))
  })
})

console.log(emitProgram(program))
