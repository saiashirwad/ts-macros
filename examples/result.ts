import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = T.build(function*() {
  const Result = yield* T.type("Result", {
    params: [T.TypeParam("T"), T.TypeParam("E")],
    body: ({ T: TParam, E: EParam }) =>
      T.Union(
        T.Object({ ok: T.Literal(true), value: TParam }),
        T.Object({ ok: T.Literal(false), error: EParam }),
      ),
  })

  const StringOrNumber = T.Apply(Result, [T.String, T.Number])

  const Parse = yield* T.fn("parse", {
    params: [T.param("raw", T.String)],
    returns: StringOrNumber,
    body: function*({ raw }) {
      yield* T.if(T.eq(raw, ""), function*() {
        yield* T.return(T.objectLiteral({ ok: false, error: 400 }))
      })
      return T.objectLiteral({ ok: true, value: raw })
    },
  })

  const outcome = yield* T.const("outcome", T.call(Parse, "hello"))

  return outcome
})

console.log(emitProgram(program))
