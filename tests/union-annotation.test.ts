import * as T from "../src/index.ts"

const repro = () => {
  const returns = Math.random() < 2 ? T.String : T.Number
  T.build(function*() {
    // @ts-expect-error the final return must satisfy every possible annotation
    return yield* T.fn("actual", {
      returns,
      body: function*() {
        return 1
      },
    })
  })
  const arrow = T.arrow({
    returns,
    body: function*() {
      return 1
    },
  })
  // @ts-expect-error arrows use the same check against each annotation
  T.const("arrow", arrow)
  const early = T.arrow({
    returns,
    body: function*() {
      yield* T.return(1)
      return T.hostValue<never>("unreachable")
    },
  })
  // @ts-expect-error early returns must also satisfy every possible annotation
  T.const("early", early)
  T.build(function*() {
    return yield* T.fn("valid", {
      returns: T.Union(T.String, T.Number),
      body: function*() {
        return 1
      },
    })
  })

  const optionalLiteral = Math.random() < 2 ? undefined : T.Literal("A")
  T.build(function*() {
    const fn = yield* T.fn("fn", {
      returns: optionalLiteral,
      body: function*() {
        return "A"
      },
    })
    // @ts-expect-error absent annotations widen the plain return to string
    return yield* T.const("actual", T.call(fn), T.Literal("A"))
  })
  const annotation = T.Object({ ok: T.Literal(true) })
  const optionalObject = Math.random() < 2 ? undefined : annotation
  T.build(function*() {
    const fn = yield* T.fn("fn", {
      returns: optionalObject,
      body: function*() {
        return { ok: true }
      },
    })
    // @ts-expect-error absent annotations widen the plain field to boolean
    return yield* T.const("actual", T.call(fn), annotation)
  })
  const optionalArrow = T.arrow({
    returns: optionalLiteral,
    body: function*() {
      return "A"
    },
  })
  // @ts-expect-error arrows also account for unannotated inference
  T.const("actual", T.call(optionalArrow), T.Literal("A"))
}
void repro
