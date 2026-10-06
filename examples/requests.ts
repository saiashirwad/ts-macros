import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = $.build(function*() {
  const Result = yield* $.type("Result", {
    params: [$.TypeParam("T"), $.TypeParam("E", $.Number)],
    body: ({ T, E }) =>
      $.Union(
        $.Object({ ok: $.Literal(true), value: T }),
        $.Object({ ok: $.Literal(false), error: E }),
      ),
  })

  const Unwrap = yield* $.type("Unwrap", {
    params: [$.TypeParam("T")],
    body: ({ T }) => $.Conditional(T, $.Promise($.Infer("U")), $.TypeParam("U"), T),
  })

  const Fields = yield* $.type("Fields", {
    params: [$.TypeParam("T")],
    body: ({ T }) => $.Mapped("K", T, $.Object({ raw: $.IndexedAccess(T, $.TypeParam("K")) })),
  })

  const At = yield* $.type("At", {
    params: [$.TypeParam("T"), $.TypeParam("K")],
    body: ({ T, K }) => $.IndexedAccess(T, K),
  })

  const Query = yield* $.type(
    "Query",
    $.Object({
      id: $.Readonly($.String),
      limit: $.Number,
    }),
  )

  const Route = yield* $.type(
    "Route",
    $.Template(["/", ""], $.Union($.Literal("users"), $.Literal("health"))),
  )

  const UserFields = yield* $.type("UserFields", $.Apply(Fields, [Query]))
  const Id = yield* $.type("Id", $.Apply(At, [Query, $.Literal("id")]))
  const Parsed = yield* $.type("Parsed", $.Apply(Result, [UserFields, $.Number]))
  const Settled = yield* $.type("Settled", $.Apply(Unwrap, [$.Promise(Parsed)]))

  const Selected = $.TypeParam("T", UserFields)
  const select = yield* $.fn("select", {
    typeParams: [Selected],
    params: [$.param("fields", Selected)],
    returns: Selected,
    body: function*({ fields }) {
      return fields
    },
  })

  const parse = yield* $.fn("parse", {
    params: [$.param("raw", $.String), $.param("limit", $.Number)],
    returns: Parsed,
    body: function*({ raw, limit }) {
      yield* $.if($.eq(raw, ""), function*() {
        yield* $.return($.object({ ok: false, error: 400 }))
      })
      return $.object({
        ok: true,
        value: {
          id: { raw },
          limit: { raw: limit },
        },
      })
    },
  })

  const present = yield* $.fn("present", {
    params: [$.param("fields", UserFields), $.param("route", Route)],
    returns: $.String,
    body: function*({ fields, route }) {
      const id = yield* $.const("id", $.prop($.prop(fields, "id"), "raw"), Id)
      return $.template(["", " ", ""], route, id)
    },
  })

  const settle = yield* $.fn("settle", {
    params: [$.param("raw", $.String), $.param("limit", $.Number)],
    returns: Settled,
    body: function*({ raw, limit }) {
      return $.call(parse, raw, limit)
    },
  })

  const user = yield* $.const("user", {
    id: { raw: "u_1" },
    limit: { raw: 20 },
  }, UserFields)
  const chosen = yield* $.const("chosen", $.call($.instantiate(select, UserFields), user))
  const line = yield* $.const("line", $.call(present, chosen, "/users"))
  const outcome = yield* $.const("outcome", $.call(settle, "u_1", 20))

  // @ts-expect-error - Result's E must extend number
  $.Apply(Result, [$.String, $.String])
  // @ts-expect-error - select's T must extend UserFields
  $.instantiate(select, $.String)

  return { chosen, line, outcome }
})

type Chosen = $.Denotes<typeof program.result.chosen>
type Line = $.Denotes<typeof program.result.line>
type Outcome = $.Denotes<typeof program.result.outcome>

type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

type User = { readonly id: { raw: string }; limit: { raw: number } }
type ParsedValue = { ok: true; value: User } | { ok: false; error: number }

export const typeChecks = (chosen: Chosen, line: Line, outcome: Outcome): void => {
  const _same: Equal<Outcome, ParsedValue> = true
  const _chosen: User = chosen
  const _line: string = line
  const _outcome: ParsedValue = outcome
  // @ts-expect-error - Unwrap<Promise<Parsed>> is the result, not the promise
  const _stillWrapped: Promise<ParsedValue> = outcome
}

console.log(emitProgram(program))
