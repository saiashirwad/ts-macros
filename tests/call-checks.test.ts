import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"

const invalidArgument = () => {
  const bad = Expr.arrow({
    returns: Type.string,
    body: function*() {
      return 1
    },
  })
  const consume = FFI.Value<(x: (string | number)[]) => void>("consume")
  // @ts-expect-error failed-check tuples are diagnostics, not liftable call arguments
  Expr.call(consume, bad)
  // @ts-expect-error nested array arguments must check each value too
  Expr.call(FFI.Value<(x: (string | number)[][]) => void>("nested"), [bad])
  // @ts-expect-error nested object arguments must check each value too
  Expr.call(FFI.Value<(x: { value: (string | number)[] }) => void>("record"), { value: bad })
  const spread = [bad]
  const choice = Math.random() > 0.5 ? bad : ["x", 1]
  // @ts-expect-error a union with a valid array must not hide a failed-check result
  Expr.call(consume, choice)
  // @ts-expect-error the shared lift check must reject the same union outside calls
  Decl.const_("choice", choice)
  // @ts-expect-error record fields cannot hide the failed member of a union
  Expr.call(FFI.Value<(x: { value: (string | number)[] }) => void>("record"), { value: choice })
  // @ts-expect-error array elements cannot hide the failed member of a union
  Expr.call(FFI.Value<(x: (string | number)[][]) => void>("nested"), [choice])
  // @ts-expect-error non-tuple spreads must not bypass argument lift checks
  Expr.call(FFI.Value<(...values: (string | number)[][]) => void>("rest"), ...spread)
  // @ts-expect-error every existing lift slot rejects diagnostic values
  Expr.lift([bad])
  // @ts-expect-error tuple-shaped diagnostic results cannot be used as index objects
  Expr.index(bad, 0)
  // @ts-expect-error nested diagnostic results cannot initialize declarations
  Decl.const_("bad", { value: bad })
  // @ts-expect-error nested diagnostic results cannot be returned
  Stmt.return_({ value: bad })
}
void invalidArgument

const validArguments = () => {
  Expr.call(FFI.Value<(x: number, y?: string) => void>("optional"), 1)
  Expr.call(FFI.Value<(x: number, y?: string) => void>("optional"), 1, "a")
  Expr.call(FFI.Value<(...values: number[]) => void>("rest"), 1, 2, 3)
  const values = [1, 2]
  Expr.call(FFI.Value<(...values: number[]) => void>("rest"), ...values)
  Expr.call(FFI.Value<(x: { values: number[] }) => void>("record"), { values: [1, 2] })
  Program.build(function*() {
    const length = yield* Decl.fn("length", {
      params: [Expr.rest("values", Type.number)],
      body: function*({ values }) {
        return Expr.prop(values, "length")
      },
    })
    return Expr.call(length, 1, 2)
  })
}
void validArguments
