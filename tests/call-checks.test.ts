import * as $ from "../src/index.ts"

const invalidArgument = () => {
  const bad = $.arrow({
    returns: $.String,
    body: function*() {
      return 1
    },
  })
  const consume = $.hostValue<(x: (string | number)[]) => void>("consume")
  // @ts-expect-error failed-check tuples are diagnostics, not liftable call arguments
  $.call(consume, bad)
  // @ts-expect-error nested array arguments must check each value too
  $.call($.hostValue<(x: (string | number)[][]) => void>("nested"), [bad])
  // @ts-expect-error nested object arguments must check each value too
  $.call($.hostValue<(x: { value: (string | number)[] }) => void>("record"), { value: bad })
  const spread = [bad]
  const choice = Math.random() > 0.5 ? bad : ["x", 1]
  // @ts-expect-error a union with a valid array must not hide a failed-check result
  $.call(consume, choice)
  // @ts-expect-error the shared lift check must reject the same union outside calls
  $.const("choice", choice)
  // @ts-expect-error record fields cannot hide the failed member of a union
  $.call($.hostValue<(x: { value: (string | number)[] }) => void>("record"), { value: choice })
  // @ts-expect-error array elements cannot hide the failed member of a union
  $.call($.hostValue<(x: (string | number)[][]) => void>("nested"), [choice])
  // @ts-expect-error non-tuple spreads must not bypass argument lift checks
  $.call($.hostValue<(...values: (string | number)[][]) => void>("rest"), ...spread)
  // @ts-expect-error every existing lift slot rejects diagnostic values
  $.lift([bad])
  // @ts-expect-error tuple-shaped diagnostic results cannot be used as index objects
  $.index(bad, 0)
  // @ts-expect-error nested diagnostic results cannot initialize declarations
  $.const("bad", { value: bad })
  // @ts-expect-error nested diagnostic results cannot be returned
  $.return({ value: bad })
}
void invalidArgument

const validArguments = () => {
  $.call($.hostValue<(x: number, y?: string) => void>("optional"), 1)
  $.call($.hostValue<(x: number, y?: string) => void>("optional"), 1, "a")
  $.call($.hostValue<(...values: number[]) => void>("rest"), 1, 2, 3)
  const values = [1, 2]
  $.call($.hostValue<(...values: number[]) => void>("rest"), ...values)
  $.call($.hostValue<(x: { values: number[] }) => void>("record"), { values: [1, 2] })
  $.build(function*() {
    const length = yield* $.fn("length", {
      params: [$.rest("values", $.Number)],
      body: function*({ values }) {
        return $.prop(values, "length")
      },
    })
    return $.call(length, 1, 2)
  })
}
void validArguments
