import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

export const program = Program.build(function*() {
  const Result = yield* Decl.type_("Result", {
    params: [Type.param("T"), Type.param("E")],
    body: ({ T, E }) =>
      Type.union(
        Type.object({ ok: Type.literal(true), value: T }),
        Type.object({ ok: Type.literal(false), error: E }),
      ),
  })

  const StringOrNumber = Type.apply(Result, [Type.string, Type.number])

  const Parse = yield* Decl.fn("parse", {
    params: [Expr.param("raw", Type.string)],
    returns: StringOrNumber,
    body: function*({ raw }) {
      yield* Stmt.if_(Expr.eq(raw, ""), function*() {
        yield* Stmt.return_(Expr.object({ ok: false, error: 400 }))
      })
      return Expr.object({ ok: true, value: raw })
    },
  })

  const outcome = yield* Decl.const_("outcome", Expr.call(Parse, "hello"))

  return outcome
})

console.log(emitProgram(program))
