import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

interface Source {
  read(): string
  score: number
  scale(value: number): number
}

export const program = Program.build(function*() {
  const source = FFI.Value<Source>("source")
  const raw = Expr.call(Expr.prop(source, "read"))
  const decorated = yield* Decl.const_("decorated", Expr.add(raw, "!"))

  const classify = yield* Decl.fn("classify", {
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
  const label = yield* Decl.const_("label", Expr.call(classify, Expr.call(scale, 4)))
  const values = yield* Decl.const_("values", [1, 2, 3])
  const total = yield* Decl.let_("total", 0)

  yield* Stmt.forOf("value", values, function*(value) {
    const doubled = yield* Decl.const_("doubled", Expr.mul(value, 2))
    yield* Stmt.assign(total, Expr.add(total, doubled))
  })

  return Expr.lift({ decorated, label, total })
})

console.log(emitProgram(program))
