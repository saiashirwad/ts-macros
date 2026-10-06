import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = $.build(function*() {
  const Result = yield* $.type("Result", {
    params: [$.TypeParam("T"), $.TypeParam("E")],
    body: ({ T, E }) =>
      $.Union(
        $.Object({ ok: $.Literal(true), value: T }),
        $.Object({ ok: $.Literal(false), error: E }),
      ),
  })

  const StringOrNumber = $.Apply(Result, [$.String, $.Number])

  const Parse = yield* $.fn("parse", {
    params: [$.param("raw", $.String)],
    returns: StringOrNumber,
    body: function*({ raw }) {
      yield* $.if($.eq(raw, ""), function*() {
        yield* $.return($.object({ ok: false, error: 400 }))
      })
      return $.object({ ok: true, value: raw })
    },
  })

  const outcome = yield* $.const("outcome", $.call(Parse, "hello"))

  return outcome
})

console.log(emitProgram(program))
