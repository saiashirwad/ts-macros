import * as T from "../src/index.ts"

const invalidArgument = () => {
  const bad = T.arrow({
    returns: T.String,
    body: function*() {
      return 1
    },
  })
  const consume = T.hostValue<(x: (string | number)[]) => void>("consume")
  // @ts-expect-error failed-check tuples are diagnostics, not liftable call arguments
  T.call(consume, bad)
  // @ts-expect-error nested array arguments must check each value too
  T.call(T.hostValue<(x: (string | number)[][]) => void>("nested"), [bad])
  // @ts-expect-error nested object arguments must check each value too
  T.call(T.hostValue<(x: { value: (string | number)[] }) => void>("record"), { value: bad })
  const spread = [bad]
  const choice = Math.random() > 0.5 ? bad : ["x", 1]
  // @ts-expect-error a union with a valid array must not hide a failed-check result
  T.call(consume, choice)
  // @ts-expect-error the shared lift check must reject the same union outside calls
  T.const("choice", choice)
  // @ts-expect-error record fields cannot hide the failed member of a union
  T.call(T.hostValue<(x: { value: (string | number)[] }) => void>("record"), { value: choice })
  // @ts-expect-error array elements cannot hide the failed member of a union
  T.call(T.hostValue<(x: (string | number)[][]) => void>("nested"), [choice])
  // @ts-expect-error non-tuple spreads must not bypass argument lift checks
  T.call(T.hostValue<(...values: (string | number)[][]) => void>("rest"), ...spread)
  // @ts-expect-error every existing lift slot rejects diagnostic values
  T.lift([bad])
  // @ts-expect-error tuple-shaped diagnostic results cannot be used as index objects
  T.index(bad, 0)
  // @ts-expect-error nested diagnostic results cannot initialize declarations
  T.const("bad", { value: bad })
  // @ts-expect-error nested diagnostic results cannot be returned
  T.return({ value: bad })
}
void invalidArgument

const validArguments = () => {
  T.call(T.hostValue<(x: number, y?: string) => void>("optional"), 1)
  T.call(T.hostValue<(x: number, y?: string) => void>("optional"), 1, "a")
  T.call(T.hostValue<(...values: number[]) => void>("rest"), 1, 2, 3)
  const values = [1, 2]
  T.call(T.hostValue<(...values: number[]) => void>("rest"), ...values)
  T.call(T.hostValue<(x: { values: number[] }) => void>("record"), { values: [1, 2] })
  T.build(function*() {
    const length = yield* T.fn("length", {
      params: [T.rest("values", T.Number)],
      body: function*({ values }) {
        return T.prop(values, "length")
      },
    })
    return T.call(length, 1, 2)
  })
}
void validArguments
