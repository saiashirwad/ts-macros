import { Decl, Expr, Program, Stmt } from "../src/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

export const program = Program.build(function*() {
  const total = yield* Decl.let_("total", 0)
  const arr = yield* Decl.const_("arr", [1, 2, 3])

  yield* Stmt.forOf("item", arr, function*(item) {
    const lol = yield* Decl.const_("lol", Expr.add(total, item))
    yield* Stmt.assign(total, lol)
  })

  yield* Stmt.while_(Expr.gt(total, 10), function*() {
    yield* Stmt.assign(total, Expr.sub(total, 1))
  })
})

console.log(emitProgram(program))
