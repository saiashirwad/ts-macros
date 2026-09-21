import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

interface Source {
  read(): string
  score: number
  scale(value: number): number
}

export const program = Program.build(function*() {
  const source = FFI.Value<Source>("source")
  const raw = Expr.call(Expr.prop(source, "read"))
  const decorated = yield* Binding.const_("decorated", Expr.add(raw, "!"))

  const classify = yield* Stmt.fn("classify", {
    params: [Expr.param("score", Type.number)],
    body: function*({ score }) {
      yield* Stmt.if_(Expr.gte(score, 90), function*() {
        yield* Stmt.return_("A")
      }).pipe(
        Stmt.elseIf(Expr.gte(score, 60), function*() {
          yield* Stmt.return_("B")
        }),
      )
      return "C"
    },
  })

  const scale = Expr.prop(source, "scale")
  const label = yield* Binding.const_("label", Expr.call(classify, Expr.call(scale, 4)))
  const values = yield* Binding.const_("values", [1, 2, 3])
  const total = yield* Binding.let_("total", 0)

  yield* Stmt.forOf("value", values, function*(value) {
    const doubled = yield* Binding.const_("doubled", Expr.mul(value, 2))
    yield* Stmt.assign(total, Expr.add(total, doubled))
  })

  return Expr.lift({ decorated, label, total })
})

console.log(emitProgram(program))
