import * as $ from "../src/index.ts"

const repro = () => {
  const returns = Math.random() < 2 ? $.String : $.Number
  $.build(function*() {
    // @ts-expect-error the final return must satisfy every possible annotation
    return yield* $.fn("actual", {
      returns,
      body: function*() {
        return 1
      },
    })
  })
  const arrow = $.arrow({
    returns,
    body: function*() {
      return 1
    },
  })
  // @ts-expect-error arrows use the same check against each annotation
  $.const("arrow", arrow)
  const early = $.arrow({
    returns,
    body: function*() {
      yield* $.return(1)
      return $.hostValue<never>("unreachable")
    },
  })
  // @ts-expect-error early returns must also satisfy every possible annotation
  $.const("early", early)
  $.build(function*() {
    return yield* $.fn("valid", {
      returns: $.Union($.String, $.Number),
      body: function*() {
        return 1
      },
    })
  })

  const optionalLiteral = Math.random() < 2 ? undefined : $.Literal("A")
  $.build(function*() {
    const fn = yield* $.fn("fn", {
      returns: optionalLiteral,
      body: function*() {
        return "A"
      },
    })
    // @ts-expect-error absent annotations widen the plain return to string
    return yield* $.const("actual", $.call(fn), $.Literal("A"))
  })
  const annotation = $.Object({ ok: $.Literal(true) })
  const optionalObject = Math.random() < 2 ? undefined : annotation
  $.build(function*() {
    const fn = yield* $.fn("fn", {
      returns: optionalObject,
      body: function*() {
        return { ok: true }
      },
    })
    // @ts-expect-error absent annotations widen the plain field to boolean
    return yield* $.const("actual", $.call(fn), annotation)
  })
  const optionalArrow = $.arrow({
    returns: optionalLiteral,
    body: function*() {
      return "A"
    },
  })
  // @ts-expect-error arrows also account for unannotated inference
  $.const("actual", $.call(optionalArrow), $.Literal("A"))
}
void repro
