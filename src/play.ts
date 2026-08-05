import * as Fn from "./function.ts"
import * as $ from "./index.ts"
import * as Let from "./let.ts"
import * as Program from "./program.ts"
import * as Type from "./type.ts"

export const program = Program.build(function* () {
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

  const BoxT = Type.Param("BoxT")

  const Box = yield* $.Build("Box").pipe(
    $.TypeParams(BoxT),
    $.Body(
      Type.Object({
        value: BoxT,
      }),
    ),
  )

  const BoxedNumber = Type.Apply(Box, [Type.Number()])

  const boxedNum = yield* Let.Let("boxedNum").pipe($.Init($.Object({ value: $.Number(2) })))

  const ResultTypeString = Type.Apply(Result, [Type.Number(), Type.String()])

  const IdentityT = Type.Param("T")
  const Identity = yield* Fn.Function("identity").pipe(
    Fn.TypeParams(IdentityT),
    Fn.Params(Fn.Param("value", IdentityT)),
    Fn.Impl(function* ({ value }) {
      return value
    }),
  )

  const First = Type.Param("First", Type.String())
  const Second = Type.Param("Second", Type.Number())

  const lol = yield* Fn.Function("lol").pipe(
    Fn.Params(Fn.Param("first", First), Fn.Param("second", Second)),
    Fn.Impl(function* ({ first, second }) {
      return second
    }),
  )

  const lolResult = yield* Let.Let("lolResult").pipe(
    $.Init(Fn.Call(lol, [$.Number(2), $.Number(2)])),
  )

  const NumberIdentity = Fn.Instantiate(Identity, Type.Number())

  const value = yield* Let.Let("value").pipe(Let.Init(Fn.Call(NumberIdentity, [$.Number(42)])))

  const result = yield* Let.Let("result").pipe(
    $.Init($.Object({ tag: $.String("Ok"), value: value })),
    $.Annotate(ResultTypeString),
  )

  return result
})

console.log(program)
