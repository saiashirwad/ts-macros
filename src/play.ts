import * as $ from "./$.ts"
import { runMacro } from "./runtime/run-macro.ts"
import * as type from "./type.ts"

export const program = runMacro(function* () {
  const T = type.param("T")
  const E = type.param("E")

  const Result = yield* $.type("Result").pipe(
    $.typeParams(T, E),
    $.body(
      type.union(
        type.object({ _tag: type.literal("Ok"), value: T }),
        type.object({ _tag: type.literal("Err"), error: E }),
      ),
    ),
  )

  const resultType = type.apply(Result, type.number(), type.string())

  const IdentityT = type.param("T")

  const identity = yield* $.function("identity").pipe(
    $.typeParams(IdentityT),
    $.params($.p("value", IdentityT)),
    // $.returns(IdentityT),
    $.impl(function* ({ value }) {
      return value
    }),
  )

  const numberIdentity = $.instantiate(identity, type.number())

  const answer = yield* $.let("answer").pipe($.init($.call(numberIdentity, [$.number(42)])))

  const result = yield* $.let("result").pipe(
    $.init(
      $.object({
        _tag: $.string("Ok"),
        value: answer,
      }),
    ),
    $.annotate(resultType),
  )

  return result
})
