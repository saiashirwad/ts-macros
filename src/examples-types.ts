import * as $ from "./$.ts"
import { emitProgram } from "./emit/index.ts"
import * as Program from "./program.ts"

// a person, then other types derived from it — the same operators you'd write
// by hand, authored like the value-level dsl.

export const program = Program.build(function*() {
  const Person = yield* $.type({
    name: $.T.string,
    age: $.T.number,
    email: $.T.string,
  })

  const Name = yield* $.type($.texpr(Person).name)
  const PersonKeys = yield* $.type($.keyof(Person))
  const Timestamped = yield* $.type($.inter(Person, { createdAt: $.T.string }))

  const Nullable = yield* $.type(["T"], (T) => $.mapped("K", T, (K) => $.union($.index(T, K), $.T.null)))
  const EventName = yield* $.type(["T"], (T) => $.tmpl`on${T}`)
  const NonNull = yield* $.type(["T"], (T) => $.cond(T, $.T.null, $.T.never, T))
  const Result = yield* $.type(["T", "E"], (T, E) =>
    $.union(
      { ok: true, value: T },
      { ok: false, error: E },
    ))
  const First = yield* $.type(["T"], (T) => $.elementOf(T))

  const PersonResult = yield* $.type($.apply(Result, [Person, $.T.string]))
  const Click = yield* $.type($.apply(EventName, ["Click"]))
  const NullablePerson = yield* $.type($.apply(Nullable, [Person]))

  const parsePerson = yield* $.fun([$.Param("raw", $.T.string)], function*({ raw }) {
    yield* $.If($.eq(raw, ""), function*() {
      yield* $.Return({ ok: false, error: "empty" })
    })
    return { ok: true, value: { name: "alice", age: 30, email: "a@b.c" } }
  })

  const greet = yield* $.fun([$.Param("name", $.index(Person, "name"))], function*({ name }) {
    return name
  })

  const firstOf = yield* $.fun([$.Param("names", $.arrayOf($.T.string))], function*({ names }) {
    void names
    return "alice"
  })

  const parsed = yield* $.Const(parsePerson("alice")).pipe(
    $.Annotate($.apply(Result, [Person, $.T.string])),
  )
  const hello = yield* $.Const(greet("alice")).pipe($.Annotate(Name))
  const head = yield* $.Const(firstOf(["alice", "bob"])).pipe(
    $.Annotate($.apply(First, [$.arrayOf($.T.string)])),
  )
  const cleaned = yield* $.Const("ok").pipe($.Annotate($.apply(NonNull, [$.union($.T.string, $.T.null)])))

  void PersonKeys
  void Timestamped
  void PersonResult
  void Click
  void NullablePerson
  return $.norm({ parsed, hello, head, cleaned })
})

console.log(emitProgram(program))
