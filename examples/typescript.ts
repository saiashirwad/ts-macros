import { emitTs, ts } from "../languages/typescript.ts"

export const program = ts.program(function*() {
  const Getters = yield* ts.alias(
    "Getters",
    [ts.typeParam("T")],
    (T) => ts.mapped("K", ts.keyof(T), (K) => ts.functionType([], ts.index(T, K)), { as: (K) => ts.template("get_", ts.intersection(K, ts.string)) }),
  )
  const user = ts.object({ name: ts.string, age: ts.optional(ts.number) })
  yield* ts.fn("show", [ts.param("getters", Getters(user))], ts.void, function*() {})

  yield* ts.fn("label", [ts.param("value", ts.union(ts.string, ts.number, ts.null))], ts.string, function*(value) {
    yield* ts.if(ts.typeOf(value, "string"), function*(text) {
      yield* ts.return(text)
    }, function*(other) {
      yield* ts.if(ts.notNull(other), function*(count) {
        yield* ts.return(ts.add(ts.literal("#"), count))
      })
    })
    yield* ts.return(ts.literal("none"))
  })
})

console.log(emitTs(program))
