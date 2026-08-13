import * as $ from "./$.ts"
import { emitProgram } from "./emit/index.ts"
import * as Program from "./program.ts"

export const program = Program.build(function*() {
  const Person = yield* $.type({
    name: $.T.string,
    age: $.T.number,
    email: $.T.string,
  })

  const Name = yield* $.type($.texpr(Person).name)
  const PersonKeys = yield* $.type($.keyof(Person))
  const Timestamped = yield* $.type($.intersect(Person, { createdAt: $.T.string }))
  const Nullable = yield* $.type(["T"], (T) => $.mapped("K", T, (K) => $.union($.index(T, K), $.T.null)))
})

console.log(emitProgram(program))
