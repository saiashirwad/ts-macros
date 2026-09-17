import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/babel/index.ts"

const T = Type.Param("T")
const E = Type.Param("E")

export const program = Program.build(function*() {
  const Result = yield* Type.Type("Result").pipe(
    Type.TypeParams(T, E),
    Type.Body(Type.Union(
      Type.Object({ ok: Type.Literal(true), value: T }),
      Type.Object({ ok: Type.Literal(false), error: E }),
    )),
  )

  const StringOrNumber = Type.Apply(Result, [Type.String(), Type.Number()])

  const Parse = yield* Fn.Function("parse").pipe(
    Fn.Params(Fn.Param("raw", Type.String())),
    Fn.Returns(StringOrNumber),
    Fn.Impl(function*({ raw }) {
      yield* Stmt.If(Expr.Binary("===", raw, Expr.String("")), function*() {
        yield* Stmt.Return(Expr.Object({ ok: Expr.Boolean(false), error: Expr.Number(400) }))
      })
      return Expr.Object({ ok: Expr.Boolean(true), value: raw })
    }),
  )

  const outcome = yield* Binding.Const("outcome").pipe(Binding.Init(Fn.Call(Parse, Expr.String("hello"))))

  return outcome
})

console.log(emitProgram(program))
