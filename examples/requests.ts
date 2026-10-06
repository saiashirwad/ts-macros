import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

export const program = T.build(function*() {
  const Result = yield* T.type("Result", {
    params: [T.TypeParam("T"), T.TypeParam("E", T.Number)],
    body: ({ T: TParam, E: EParam }) =>
      T.Union(
        T.Object({ ok: T.Literal(true), value: TParam }),
        T.Object({ ok: T.Literal(false), error: EParam }),
      ),
  })

  const Unwrap = yield* T.type("Unwrap", {
    params: [T.TypeParam("T")],
    body: ({ T: TParam }) => T.Conditional(TParam, T.Promise(T.Infer("U")), T.TypeParam("U"), TParam),
  })

  const Fields = yield* T.type("Fields", {
    params: [T.TypeParam("T")],
    body: ({ T: TParam }) => T.Mapped("K", TParam, T.Object({ raw: T.IndexedAccess(TParam, T.TypeParam("K")) })),
  })

  const At = yield* T.type("At", {
    params: [T.TypeParam("T"), T.TypeParam("K")],
    body: ({ T: TParam, K: KParam }) => T.IndexedAccess(TParam, KParam),
  })

  const Query = yield* T.type(
    "Query",
    T.Object({
      id: T.Readonly(T.String),
      limit: T.Number,
    }),
  )

  const Route = yield* T.type(
    "Route",
    T.Template(["/", ""], T.Union(T.Literal("users"), T.Literal("health"))),
  )

  const UserFields = yield* T.type("UserFields", T.Apply(Fields, [Query]))
  const Id = yield* T.type("Id", T.Apply(At, [Query, T.Literal("id")]))
  const Parsed = yield* T.type("Parsed", T.Apply(Result, [UserFields, T.Number]))
  const Settled = yield* T.type("Settled", T.Apply(Unwrap, [T.Promise(Parsed)]))

  const Selected = T.TypeParam("T", UserFields)
  const select = yield* T.fn("select", {
    typeParams: [Selected],
    params: [T.param("fields", Selected)],
    returns: Selected,
    body: function*({ fields }) {
      return fields
    },
  })

  const parse = yield* T.fn("parse", {
    params: [T.param("raw", T.String), T.param("limit", T.Number)],
    returns: Parsed,
    body: function*({ raw, limit }) {
      yield* T.if(T.eq(raw, ""), function*() {
        yield* T.return(T.objectLiteral({ ok: false, error: 400 }))
      })
      return T.objectLiteral({
        ok: true,
        value: {
          id: { raw },
          limit: { raw: limit },
        },
      })
    },
  })

  const present = yield* T.fn("present", {
    params: [T.param("fields", UserFields), T.param("route", Route)],
    returns: T.String,
    body: function*({ fields, route }) {
      const id = yield* T.const("id", T.prop(T.prop(fields, "id"), "raw"), Id)
      return T.template(["", " ", ""], route, id)
    },
  })

  const settle = yield* T.fn("settle", {
    params: [T.param("raw", T.String), T.param("limit", T.Number)],
    returns: Settled,
    body: function*({ raw, limit }) {
      return T.call(parse, raw, limit)
    },
  })

  const user = yield* T.const("user", {
    id: { raw: "u_1" },
    limit: { raw: 20 },
  }, UserFields)
  const chosen = yield* T.const("chosen", T.call(T.instantiate(select, UserFields), user))
  const line = yield* T.const("line", T.call(present, chosen, "/users"))
  const outcome = yield* T.const("outcome", T.call(settle, "u_1", 20))

  // @ts-expect-error - Result's E must extend number
  T.Apply(Result, [T.String, T.String])
  // @ts-expect-error - select's T must extend UserFields
  T.instantiate(select, T.String)

  return { chosen, line, outcome }
})

type Chosen = T.Denotes<typeof program.result.chosen>
type Line = T.Denotes<typeof program.result.line>
type Outcome = T.Denotes<typeof program.result.outcome>

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
