import * as $ from "./index.ts"
import { runMacro } from "./program.ts"
import * as Type from "./type.ts"

export const program = runMacro(function* () {
  const T = Type.Param("T")
  const E = Type.Param("E")
  const TE = $.TypeParams(T, E)

  const Result = yield* $.Build("Result").pipe(
    TE,
    $.Body(
      Type.Union(
        Type.Object({ tag: Type.Literal("Ok"), value: T }),
        Type.Object({ tag: Type.Literal("Err"), error: E }),
      ),
    ),
  )
  return Result

  // const name = yield* $.let("name").pipe($.init($.String("hi")))
  // const age = yield* $.let("age").pipe($.init($.Number(2)))
  //
  // const ResultTypeString = Type.Apply(Result, [Type.Number(), Type.String()])
  //
  // const IdentityT = Type.Param("T")

  // const identity = yield* $.function("identity").pipe(
  //   $.typeParams(IdentityT),
  //   $.params($.p("value", IdentityT)),
  //   $.impl(function* ({ value }) {
  //     /* oxlint-disable */
  //     return value
  //   }),
  // )

  // const numberIdentity = $.instantiate(identity, Type.Number())

  // const answer = yield* $.let("answer").pipe($.init($.call(numberIdentity, [$.number(42)])))

  // const result = yield* $.let("result").pipe(
  //   $.init(
  //     $.object({
  //       tag: $.string("Ok"),
  //       value: answer,
  //     }),
  //   ),
  //   $.annotate(ResultTypeString),
  // )

  // return result
})

console.log(program)
