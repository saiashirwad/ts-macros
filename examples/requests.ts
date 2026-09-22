// One request, followed from the type operators down to a call.
//
// Result, Unwrap, Fields, and At are generic. Query and Route are not.
// UserFields, Id, Parsed, and Settled apply the generics to this request,
// and parse, present, and settle take those applications. select stays
// generic, constrained by UserFields, and is instantiated at the call.

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

export const program = Program.build(function*() {
  // type Result<T, E extends number> = { ok: true; value: T } | { ok: false; error: E }
  const Result = yield* Type.type_("Result", {
    params: [Type.param("T"), Type.param("E", Type.number)],
    body: ({ T, E }) =>
      Type.union(
        Type.object({ ok: Type.literal(true), value: T }),
        Type.object({ ok: Type.literal(false), error: E }),
      ),
  })

  // type Unwrap<T> = T extends Promise<infer U> ? U : T
  const Unwrap = yield* Type.type_("Unwrap", {
    params: [Type.param("T")],
    body: ({ T }) => Type.conditional(T, Type.promise(Type.infer_("U")), Type.param("U"), T),
  })

  // type Fields<T> = { [K in keyof T]: { raw: T[K] } }
  const Fields = yield* Type.type_("Fields", {
    params: [Type.param("T")],
    body: ({ T }) => Type.mapped("K", T, Type.object({ raw: Type.index(T, Type.param("K")) })),
  })

  // type At<T, K> = T[K]
  const At = yield* Type.type_("At", {
    params: [Type.param("T"), Type.param("K")],
    body: ({ T, K }) => Type.index(T, K),
  })

  // type Query = { readonly id: string; limit: number }
  const Query = yield* Type.type_(
    "Query",
    Type.object({
      id: Type.readonly_(Type.string),
      limit: Type.number,
    }),
  )

  // type Route = `/${"users" | "health"}`
  const Route = yield* Type.type_(
    "Route",
    Type.template(["/", ""], Type.union(Type.literal("users"), Type.literal("health"))),
  )

  // the generics, applied to this request
  const UserFields = yield* Type.type_("UserFields", Type.apply(Fields, [Query]))
  const Id = yield* Type.type_("Id", Type.apply(At, [Query, Type.literal("id")]))
  const Parsed = yield* Type.type_("Parsed", Type.apply(Result, [UserFields, Type.number]))
  const Settled = yield* Type.type_("Settled", Type.apply(Unwrap, [Type.promise(Parsed)]))

  // function select<T extends UserFields>(fields: T): T
  const Selected = Type.param("T", UserFields)
  const select = yield* Stmt.fn("select", {
    typeParams: [Selected],
    params: [Expr.param("fields", Selected)],
    returns: Selected,
    body: function*({ fields }) {
      return fields
    },
  })

  // function parse(raw: string, limit: number): Parsed
  const parse = yield* Stmt.fn("parse", {
    params: [Expr.param("raw", Type.string), Expr.param("limit", Type.number)],
    returns: Parsed,
    body: function*({ raw, limit }) {
      yield* Stmt.if_(Expr.eq(raw, ""), function*() {
        yield* Stmt.return_(Expr.object({ ok: false, error: 400 }))
      })
      return Expr.object({
        ok: true,
        value: {
          id: { raw },
          limit: { raw: limit },
        },
      })
    },
  })

  // function present(fields: UserFields, route: Route): string
  // `id` is annotated with At<Query, "id">, so the field read has to be that application
  const present = yield* Stmt.fn("present", {
    params: [Expr.param("fields", UserFields), Expr.param("route", Route)],
    returns: Type.string,
    body: function*({ fields, route }) {
      const id = yield* Binding.const_("id", Expr.prop(Expr.prop(fields, "id"), "raw"), Id)
      return Expr.template(["", " ", ""], route, id)
    },
  })

  // function settle(raw: string, limit: number): Settled
  // Settled is Unwrap<Promise<Parsed>>, which is Parsed
  const settle = yield* Stmt.fn("settle", {
    params: [Expr.param("raw", Type.string), Expr.param("limit", Type.number)],
    returns: Settled,
    body: function*({ raw, limit }) {
      return Expr.call(parse, raw, limit)
    },
  })

  const user = yield* Binding.const_("user", {
    id: { raw: "u_1" },
    limit: { raw: 20 },
  }, UserFields)
  const chosen = yield* Binding.const_("chosen", Expr.call(Expr.instantiate(select, UserFields), user))
  const line = yield* Binding.const_("line", Expr.call(present, chosen, "/users"))
  const outcome = yield* Binding.const_("outcome", Expr.call(settle, "u_1", 20))

  // @ts-expect-error - Result's E must extend number
  Type.apply(Result, [Type.string, Type.string])
  // @ts-expect-error - select's T must extend UserFields
  Expr.instantiate(select, Type.string)

  return { chosen, line, outcome }
})

type Chosen = Expr.Denotes<typeof program.result.chosen>
type Line = Expr.Denotes<typeof program.result.line>
type Outcome = Expr.Denotes<typeof program.result.outcome>

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
