import { emitTs, ts } from "../languages/typescript.ts"

export const program = ts.program(function*() {
  const log = ts.get(ts.hostValue<Console>("console"), "log")
  const math = ts.hostValue<Math>("Math")
  const promise = ts.hostValue<PromiseConstructor>("Promise")
  const json = ts.hostValue<JSON>("JSON")
  const number = ts.hostValue<NumberConstructor>("Number")
  const Getters = yield* ts.alias(
    "Getters",
    [ts.typeParam("T")],
    (T) => ts.mapped("K", ts.keyof(T), (K) => ts.functionType([], ts.index(T, K)), { as: (K) => ts.template("get_", ts.intersection(K, ts.string)) }),
  )
  const user = ts.object({ name: ts.string, age: ts.optional(ts.number) })

  const label = yield* ts.fn("label", [ts.param("value", ts.union(ts.string, ts.number, ts.null))], ts.string, function*(value) {
    yield* ts.if(ts.typeOf(value, "string"), function*(text) {
      yield* ts.return(text)
    }, function*(other) {
      yield* ts.if(ts.notNull(other), function*(count) {
        yield* ts.return(ts.add(ts.literal("#"), count))
      })
    })
    yield* ts.return(ts.literal("none"))
  })

  const summary = yield* ts.fn("summary", [ts.param("count", ts.number)], ts.string, function*(count) {
    const shown = yield* ts.let("shown", ts.call(label, count))
    const missing = yield* ts.let("missing", ts.call(label, ts.literal(null)), ts.string)
    yield* ts.return(ts.add(shown, missing))
  })

  const Result = yield* ts.alias(
    "Result",
    [ts.typeParam("T"), ts.typeParam("E")],
    (T, E) => ts.union(ts.object({ ok: ts.literalType(true), value: T }), ts.object({ ok: ts.literalType(false), error: E })),
  )

  const describe = yield* ts.fn("describe", [ts.param("result", Result(ts.number, ts.string))], ts.string, function*(result) {
    yield* ts.if(ts.equals(ts.get(result, "ok"), ts.literal(true)), function*(success) {
      const value = yield* ts.let("value", ts.get(success, "value"))
      yield* ts.return(ts.add(ts.literal("ok: "), value))
    }, function*(failure) {
      yield* ts.return(ts.add(ts.literal("error: "), ts.get(failure, "error")))
    })
  })

  const unwrapOr = yield* ts.fn(
    "unwrapOr",
    [ts.param("result", Result(ts.number, ts.string)), ts.param("fallback", ts.number)],
    ts.number,
    function*(result, fallback) {
      yield* ts.if(ts.notEquals(ts.get(result, "ok"), ts.literal(true)), function*() {
        yield* ts.return(fallback)
      }, function*(success) {
        yield* ts.return(ts.get(success, "value"))
      })
    },
  )

  const addResults = yield* ts.fn(
    "addResults",
    [ts.param("first", Result(ts.number, ts.string)), ts.param("second", Result(ts.number, ts.string))],
    ts.number,
    function*(first, second) {
      const sum = yield* ts.let("sum", ts.call(unwrapOr, first, ts.literal(0)))
      yield* ts.assign(sum, ts.add(sum, ts.call(unwrapOr, second, ts.literal(0))))
      yield* ts.return(sum)
    },
  )

  const Figure = yield* ts.alias(
    "Figure",
    [],
    () =>
      ts.union(
        ts.object({ kind: ts.literalType("circle"), radius: ts.number }),
        ts.object({ kind: ts.literalType("square"), side: ts.number }),
        ts.object({ kind: ts.literalType("rect"), width: ts.number, height: ts.number }),
      ),
  )

  const extent = yield* ts.fn("extent", [ts.param("figure", Figure)], ts.number, function*(figure) {
    yield* ts.if(ts.equals(ts.get(figure, "kind"), ts.literal("circle")), function*(circle) {
      yield* ts.return(ts.get(circle, "radius"))
    }, function*(other) {
      yield* ts.if(ts.equals(ts.get(other, "kind"), ts.literal("square")), function*(square) {
        const side = yield* ts.let("side", ts.get(square, "side"))
        yield* ts.return(ts.add(ts.add(side, side), ts.add(side, side)))
      }, function*(rect) {
        const half = yield* ts.let("half", ts.add(ts.get(rect, "width"), ts.get(rect, "height")))
        yield* ts.return(ts.add(half, half))
      })
    })
  })

  const isUser = yield* ts.fn("isUser", [ts.param("value", ts.unknown)], ts.predicate(0, user), function*(value) {
    yield* ts.if(ts.typeOf(value, "object"), function*(object) {
      yield* ts.if(ts.notNull(object), function*() {
        yield* ts.return(ts.literal(true))
      })
    })
    yield* ts.return(ts.literal(false))
  })

  const greet = yield* ts.fn("greet", [ts.param("value", ts.unknown), ts.param("getters", Getters(user))], ts.string, function*(value, getters) {
    yield* ts.if(ts.call(isUser, value), function*(found) {
      yield* ts.return(ts.add(ts.literal("hello, "), ts.get(found, "name")))
    })
    yield* ts.return(ts.add(ts.literal("hello again, "), ts.call(ts.get(getters, "get_name"))))
  })

  const sumBelow = yield* ts.fn("sumBelow", [ts.param("limit", ts.number)], ts.number, function*(limit) {
    const total = yield* ts.let("total", ts.literal(0))
    const i = yield* ts.let("i", ts.literal(0))
    yield* ts.while(ts.less(i, limit), function*() {
      yield* ts.assign(total, ts.add(total, i))
      yield* ts.assign(i, ts.add(i, ts.literal(1)))
    })
    yield* ts.return(total)
  })

  const ElementOf = yield* ts.alias("ElementOf", [ts.typeParam("T")], (T) => ts.infer(T, ["E"], (E) => ts.array(E), (E) => E, ts.never))

  const head = yield* ts.fn(
    "head",
    [ts.param("items", ts.union(ts.array(ts.string), ts.string))],
    ts.union(ElementOf(ts.array(ts.string)), ts.undefined),
    function*(items) {
      yield* ts.if(ts.isArray(items), function*(list) {
        yield* ts.return(ts.get(list, 0))
      }, function*(single) {
        yield* ts.return(single)
      })
    },
  )

  yield* ts.fn(
    "main",
    [ts.param("result", Result(ts.number, ts.string)), ts.param("figure", Figure), ts.param("value", ts.unknown), ts.param("getters", Getters(user))],
    ts.void,
    function*(result, figure, value, getters) {
      const labelled = yield* ts.let("labelled", ts.call(label, ts.literal(7)))
      const summarized = yield* ts.let("summarized", ts.call(summary, ts.literal(3)))
      const described = yield* ts.let("described", ts.call(describe, result))
      const unwrapped = yield* ts.let("unwrapped", ts.call(unwrapOr, result, ts.literal(0)))
      const added = yield* ts.let("added", ts.call(addResults, result, result))
      const measured = yield* ts.let("measured", ts.call(extent, figure))
      const known = yield* ts.let("known", ts.call(isUser, value))
      const greeted = yield* ts.let("greeted", ts.call(greet, value, getters))
      const summed = yield* ts.let("summed", ts.call(sumBelow, ts.literal(10)))
      const first = yield* ts.let("first", ts.call(head, ts.literal("only")))
      yield* ts.run(ts.call(log, labelled))
      yield* ts.run(ts.call(log, summarized))
      yield* ts.run(ts.call(log, described))
      yield* ts.run(ts.call(log, unwrapped))
      yield* ts.run(ts.call(log, added))
      yield* ts.run(ts.call(log, measured))
      yield* ts.run(ts.call(log, known))
      yield* ts.run(ts.call(log, greeted))
      yield* ts.run(ts.call(log, summed))
      yield* ts.run(ts.call(log, first))

      const floored = yield* ts.let("floored", ts.call(ts.get(math, "floor"), ts.literal(7.8)))
      const biggest = yield* ts.let("biggest", ts.call(ts.get(math, "max"), floored, summed, ts.literal(3)))
      const root = yield* ts.let("root", ts.call(ts.get(math, "sqrt"), ts.add(unwrapped, added)))
      const pi = yield* ts.let("pi", ts.get(math, "PI"))
      yield* ts.run(ts.call(log, floored, biggest, root, pi))

      const resolved = yield* ts.let("resolved", ts.call(ts.get(promise, "resolve"), described))
      const failed = yield* ts.let("failed", ts.call(ts.get(promise, "reject"), greeted))
      yield* ts.run(ts.call(log, resolved, failed))

      const shouted = yield* ts.let("shouted", ts.call(ts.get(greeted, "toUpperCase")))
      const size = yield* ts.let("size", ts.get(shouted, "length"))
      const trimmed = yield* ts.let("trimmed", ts.call(ts.get(described, "trim")))
      const padded = yield* ts.let("padded", ts.call(ts.get(trimmed, "padStart"), ts.literal(20), ts.literal(".")))
      const sliced = yield* ts.let("sliced", ts.call(ts.get(padded, "slice"), ts.literal(0), ts.literal(5)))
      const starts = yield* ts.let("starts", ts.call(ts.get(greeted, "startsWith"), ts.literal("hello")))
      const code = yield* ts.let("code", ts.call(ts.get(labelled, "charCodeAt"), ts.literal(0)))
      const parsed = yield* ts.let("parsed", ts.call(ts.get(number, "parseInt"), sliced, ts.literal(10)))
      const fixed = yield* ts.let("fixed", ts.call(ts.get(root, "toFixed"), ts.literal(2)))
      const encoded = yield* ts.let("encoded", ts.call(ts.get(json, "stringify"), sliced))
      const decoded = yield* ts.let("decoded", ts.call(ts.get(json, "parse"), encoded))
      yield* ts.run(ts.call(log, shouted, size, padded, starts, code, parsed, fixed, decoded))
    },
  )
})

console.log(emitTs(program))
