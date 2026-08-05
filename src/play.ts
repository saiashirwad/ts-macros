import * as Expr from "./expr.ts"
import * as Fn from "./function.ts"
import * as Let from "./let.ts"
import * as Program from "./program.ts"
import * as Type from "./type.ts"

export const program = Program.build(function* () {
  const T = Type.Param("T")
  const E = Type.Param("E")

  const Result = yield* Type.Type("Result").pipe(
    Type.TypeParams(T, E),
    Type.Body(
      Type.Union(
        Type.Object({ tag: Type.Literal("Ok"), value: T }),
        Type.Object({ tag: Type.Literal("Err"), error: E }),
      ),
    ),
  )

  const IdentityT = Type.Param("T")
  const Identity = yield* Fn.Function("identity").pipe(
    Fn.TypeParams(IdentityT),
    Fn.Params(Fn.Param("value", IdentityT)),
    Fn.Impl(function* ({ value }) {
      return value
    }),
  )

  const NumberIdentity = Fn.Instantiate(Identity, Type.Number())

  const value = yield* Let.Let("value").pipe(Let.Init(Fn.Call(NumberIdentity, Expr.Number(42))))

  const result = yield* Let.Let("result").pipe(
    Let.Init(Expr.Object({ tag: Expr.String("Ok"), value: value })),
  )

  return result
})

console.log(program)
