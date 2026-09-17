import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Sugar from "../src/sugar/index.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

interface Source {
  read(): string
  score: number
  scale(value: number): number
}

export const program = Program.build(function*() {
  const source = FFI.Value<Source>("source")
  const raw = Sugar.call(Expr.Prop(source, "read"))
  const decorated = yield* Sugar.Const("decorated", Sugar.add(raw, "!"))

  const classify = yield* Fn.Function("classify").pipe(
    Fn.Params(Fn.Param("score", Type.Number())),
    Fn.Impl(function*({ score }) {
      yield* Stmt.If(Sugar.gte(score, 90), function*() {
        yield* Stmt.Return(Sugar.norm("A"))
      }).pipe(
        Stmt.ElseIf(Sugar.gte(score, 60), function*() {
          yield* Stmt.Return(Sugar.norm("B"))
        }),
      )
      return Sugar.norm("C")
    }),
  )

  const label = yield* Sugar.Const("label", Sugar.call(classify, Sugar.call(Expr.Prop(source, "scale"), 4)))
  const values = yield* Sugar.Const("values", [1, 2, 3])
  const total = yield* Sugar.Let("total", 0)

  yield* Sugar.ForOf("value", values, function*(value) {
    const doubled = yield* Sugar.Const("doubled", Sugar.mul(value, 2))
    yield* Sugar.Assign(total, Sugar.add(total, doubled))
  })

  return Sugar.norm({ decorated, label, total })
})

console.log(emitProgram(program))
