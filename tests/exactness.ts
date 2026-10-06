import * as $ from "../src/index.ts"
import type { Equal, ExactCase } from "./typing.ts"

export const rawObject = $.object({ a: 1 })
export const emptyArray = $.array()

type Tree = { value: number; children: Tree[] }
const tree: Tree = { value: 1, children: [] }

const guarded = <A, Out>(type: $.Type<A>, guard: (input: $.Ref<A, true>) => $.Guard<Out>, ambient: string = "") => {
  let expression: $.Ref<Out, false> | undefined
  const program = $.build(function*() {
    const input = yield* $.let("input", $.call($.hostValue<() => never>("fail")), type)
    const fn = yield* $.fn("guarded", {
      body: function*() {
        yield* $.ifGuard(guard(input), function*(narrowed) {
          expression = narrowed
          yield* $.return(narrowed)
        })
        return $.call($.hostValue<() => never>("fail"))
      },
    })
    return yield* $.const("actual", $.call(fn))
  })
  return { ambient: `declare function fail(): never; ${ambient}`, program, expression: expression! }
}

const isDate = $.hostValue<(value: unknown) => value is Date>("isDate")
const date = $.External<Date>("Date")
const datePredicate = "declare function isDate(value: unknown): value is Date;"
const isRow = $.hostValue<(value: unknown) => value is { x: number }>("isRow")
const row = $.Object({ x: $.Number })
const rowPredicate = "declare function isRow(value: unknown): value is { x: number };"

const rejected = <A, Negative>(
  type: $.Type<A>,
  guard: (input: $.Ref<A, true>) => $.Guard<any> & { readonly complement: $.Type<Negative>; readonly complementCheck?: readonly [] },
  ambient: string = "",
  native: boolean = true,
) => {
  let expression: $.Ref<Negative, false> | undefined
  const program = $.build(function*() {
    const input = yield* $.let("input", $.call($.hostValue<() => never>("fail")), type)
    const value = guard(input)
    const alias = yield* $.fn("alias", {
      body: function*() {
        const builder = $.ifGuard(value, function*() {
          yield* $.throw(0)
        })
        yield* builder.elseGuard(
          function*(rest) {
            expression = rest
            yield* $.return(rest)
          },
          "rest",
        )
        return $.call($.hostValue<() => never>("fail"))
      },
    })
    const nativeFalse = yield* $.fn("nativeFalse", {
      body: function*() {
        yield* $.if(value.condition, function*() {
          yield* $.throw(0)
        }).pipe($.else(function*() {
          yield* $.return(input)
        }))
        return $.call($.hostValue<() => never>("fail"))
      },
    })
    return native ? yield* $.const("actual", $.call(nativeFalse)) : yield* $.const("actual", $.call(alias))
  })
  return { ambient: `declare function fail(): never; ${ambient}`, program, expression: expression! }
}

const optionalRows = $.Union($.Object({ a: $.Optional($.Number) }), $.Object({ b: $.String }))
const taggedRows = $.Union(
  $.Object({ kind: $.Literal("a") }),
  $.Object({ kind: $.Literal("b") }),
  $.Object({ kind: $.Literal("c") }),
)

export const cases = {
  elseUnknownTypeof: rejected($.Unknown, (input) => $.isTypeof(input, "string")),
  elseUnknownNumber: rejected($.Unknown, (input) => $.isTypeof(input, "number")),
  elseUnknownBoolean: rejected($.Unknown, (input) => $.isTypeof(input, "boolean")),
  elseUnknownBigint: rejected($.Unknown, (input) => $.isTypeof(input, "bigint")),
  elseUnknownSymbol: rejected($.Unknown, (input) => $.isTypeof(input, "symbol")),
  elseUnknownUndefined: rejected($.Unknown, (input) => $.isTypeof(input, "undefined")),
  elseUnknownObject: rejected($.Unknown, (input) => $.isTypeof(input, "object")),
  elseUnknownFunction: rejected($.Unknown, (input) => $.isTypeof(input, "function")),
  elseUnionString: rejected($.Union($.Literal("yes"), $.Number, $.Null), (input) => $.isTypeof(input, "string")),
  elseUnionNumber: rejected($.Union($.String, $.Number), (input) => $.isTypeof(input, "number")),
  elseUnionBoolean: rejected($.Union($.String, $.Boolean), (input) => $.isTypeof(input, "boolean")),
  elseUnionBigint: rejected($.Union($.String, $.BigInt), (input) => $.isTypeof(input, "bigint")),
  elseUnionSymbol: rejected($.Union($.String, $.Symbol), (input) => $.isTypeof(input, "symbol")),
  elseUnionUndefined: rejected($.Union($.String, $.Undefined), (input) => $.isTypeof(input, "undefined")),
  elseUnionObject: rejected($.Union(row, $.Null, $.String, $.Function([], $.Number)), (input) => $.isTypeof(input, "object")),
  elseUnionFunction: rejected($.Union(row, $.Function([], $.Number)), (input) => $.isTypeof(input, "function")),
  elseBroadFunction: rejected($.NonPrimitive, (input) => $.isTypeof(input, "function")),
  elseRecordFunction: rejected(row, (input) => $.isTypeof(input, "function")),
  elseNeverFunction: rejected($.Function([], $.Number), (input) => $.isTypeof(input, "function")),
  elseUnknownNullish: rejected($.Unknown, (input) => $.notNullish(input)),
  elseUnionNullish: rejected($.Union($.String, $.Null, $.Undefined), (input) => $.notNullish(input)),
  elseVoidNullish: rejected($.Void, (input) => $.notNullish(input)),
  elseNeverNullish: rejected(row, (input) => $.notNullish(input)),
  elseUnknownArray: rejected($.Unknown, (input) => $.isArray(input)),
  elseUnionArray: rejected($.Union($.Array($.Number), $.String, $.Null), (input) => $.isArray(input)),
  elseReadonlyArray: rejected($.ReadonlyArray($.Number), (input) => $.isArray(input)),
  elseMixedArray: rejected($.Union($.ReadonlyArray($.Number), $.Array($.String), $.Null), (input) => $.isArray(input)),
  elseTupleArray: rejected($.Union($.Tuple($.Number), $.String), (input) => $.isArray(input)),
  elseEq: rejected(taggedRows, (input) => $.isEq(input, "kind", "a")),
  elseIn: rejected($.Union(row, $.Object({ y: $.String })), (input) => $.in(input, "x")),
  elseOptionalIn: rejected(optionalRows, (input) => $.in(input, "a")),
  elseUnlistedIn: rejected(optionalRows, (input) => $.in(input, "missing")),
  elseObjectIn: rejected($.NonPrimitive, (input) => $.in(input, "missing")),
  elseOwn: rejected(optionalRows, (input) => $.hasOwn(input, "a")),
  elseOwnArray: rejected($.Array($.Number), (input) => $.hasOwn(input, "0")),
  elseUnknownInstance: rejected($.Unknown, (input) => $.instanceOf(input, $.hostValue<typeof Date>("Date"), date)),
  elseObjectInstance: rejected($.NonPrimitive, (input) => $.instanceOf(input, $.hostValue<typeof Date>("Date"), date)),
  elseNullableInstance: rejected(
    $.Union(date, $.Null, $.Undefined),
    (input) => $.instanceOf(input, $.hostValue<typeof Date>("Date"), date),
  ),
  elseUnknownPredicate: rejected($.Unknown, (input) => $.predicate(isRow, input, row), rowPredicate),
  elseExactInstance: rejected(date, (input) => $.instanceOf(input, $.hostValue<typeof Date>("Date"), date)),
  elseAbstractInstance: rejected(
    $.Unknown,
    (input) => $.instanceOf(input, $.hostValue<abstract new() => Date>("Ctor"), date),
    "declare const Ctor: abstract new () => Date;",
  ),
  elseObjectPredicate: rejected($.NonPrimitive, (input) => $.predicate(isRow, input, row), rowPredicate),
  elseUnionPredicate: rejected($.Union(row, $.String, $.Null), (input) => $.predicate(isRow, input, row), rowPredicate),
  elseFilteredPredicate: rejected($.Union(row, $.Object({ y: $.String })), (input) => $.predicate(isRow, input, row), rowPredicate),
  elseExactPredicate: rejected(row, (input) => $.predicate(isRow, input, row), rowPredicate),
  elseUnknownUnionPredicate: rejected(
    $.Unknown,
    (input) => $.predicate($.hostValue<(value: unknown) => value is string | number>("isScalar"), input, $.Union($.String, $.Number)),
    "declare function isScalar(value: unknown): value is string | number;",
  ),
  elseAndUnknown: rejected($.Unknown, (input) => $.allOf($.isTypeof(input, "object"), $.notNullish(input))),
  elseAndUnion: rejected(
    $.Union($.NonPrimitive, $.Null, $.String),
    (input) => $.allOf($.isTypeof(input, "object"), $.notNullish(input)),
  ),
  elseAndReverse: rejected(
    $.Union($.NonPrimitive, $.Null, $.String),
    (input) => $.allOf($.notNullish(input), $.isTypeof(input, "object")),
  ),
  elseAndIn: rejected(optionalRows, (input) => $.allOf($.in(input, "a"), $.hasOwn(input, "a"))),
  elseAndInTypeof: rejected($.NonPrimitive, (input) => $.allOf($.in(input, "value"), $.isTypeof(input, "object"))),
  elseAndEq: rejected(taggedRows, (input) => $.allOf($.isTypeof(input, "object"), $.isEq(input, "kind", "a"))),
  elseAndArray: rejected(
    $.Union($.ReadonlyArray($.Number), $.Array($.String), $.Null),
    (input) => $.allOf($.isArray(input), $.notNullish(input)),
  ),
  elseAndNested: rejected(
    $.Unknown,
    (input) => $.allOf($.isTypeof(input, "object"), $.allOf($.notNullish(input), $.notNullish(input))),
  ),
  elseAliasNullish: rejected($.Unknown, (input) => $.notNullish(input), "", false),
  elseAndInstance: rejected(
    $.Unknown,
    (input) => $.allOf($.instanceOf(input, $.hostValue<typeof Date>("Date"), date), $.notNullish(input)),
  ),
  elseAndPredicate: rejected($.Unknown, (input) => $.allOf($.predicate(isRow, input, row), $.notNullish(input)), rowPredicate),
  elseAndReadonlyOwn: rejected($.ReadonlyArray($.Number), (input) => $.allOf($.isArray(input), $.hasOwn(input, "0"))),
  elseAliasMixedArray: rejected(
    $.Union($.ReadonlyArray($.Number), $.Array($.String), $.Null),
    (input) => $.isArray(input),
    "",
    false,
  ),
  elseAliasEq: rejected(taggedRows, (input) => $.isEq(input, "kind", "a"), "", false),
  elseAliasAnd: rejected(
    $.Union($.NonPrimitive, $.Null, $.String),
    (input) => $.allOf($.isTypeof(input, "object"), $.notNullish(input)),
    "",
    false,
  ),
  elseAliasDeclarationNarrowing: {
    program: $.build(function*() {
      const fn = yield* $.fn("read", {
        body: function*() {
          const input = yield* $.const("input", $.null(), $.Union($.String, $.Number, $.Null))
          yield* $.ifGuard($.isTypeof(input, "string"), function*() {
            yield* $.throw(0)
          }).elseGuard(function*(rest) {
            yield* $.return(rest)
          })
          return $.call($.hostValue<() => never>("fail"))
        },
      })
      return yield* $.const("actual", $.call(fn))
    }),
    ambient: "declare function fail(): never;",
  },
  readonlyArrayAnnotation: {
    program: $.build(function*() {
      return yield* $.const("actual", $.array(1, 2), $.ReadonlyArray($.Number))
    }),
  },
  readonlyArrayLiteralContext: {
    program: $.build(function*() {
      return yield* $.const("actual", $.array($.object({ ok: true })), $.ReadonlyArray($.Object({ ok: $.Literal(true) })))
    }),
  },
  readonlyNestedArray: {
    program: $.build(function*() {
      return yield* $.const("actual", [[1]], $.Array($.ReadonlyArray($.Number)))
    }),
  },
  readonlyArrayIndex: {
    program: $.build(function*() {
      const items = yield* $.const("items", [1], $.ReadonlyArray($.Number))
      return yield* $.const("actual", $.index(items, 0))
    }),
  },
  readonlyArrayForOf: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("items", $.ReadonlyArray($.Literal("yes")))],
        body: function*({ items }) {
          yield* $.forOf("item", items, function*(item) {
            yield* $.return(item)
          })
          return $.call($.hostValue<() => never>("fail"))
        },
      })
    }),
    ambient: "declare function fail(): never;",
  },
  readonlyArrayWrite: {
    diagnostics: [2542],
    program: $.build(function*() {
      const items = yield* $.const("items", [1], $.ReadonlyArray($.Number))
      // @ts-expect-error readonly arrays reject index writes
      yield* $.assign($.index(items, 0), 2)
      return yield* $.const("actual", items)
    }),
  },
  readonlyArrayLengthWrite: {
    diagnostics: [2540],
    program: $.build(function*() {
      const items = yield* $.const("items", [1], $.ReadonlyArray($.Number))
      // @ts-expect-error readonly array length is readonly too
      yield* $.assign($.prop(items, "length"), 2)
      return yield* $.const("actual", items)
    }),
  },
  readonlyArraySubstitution: {
    program: $.build(function*() {
      const list = yield* $.type("List", { params: [$.TypeParam("T")], body: ({ T }) => $.ReadonlyArray(T) })
      return yield* $.const("actual", [1], $.Apply(list, [$.Number]))
    }),
  },
  readonlyUnionIndex: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("items", $.Union($.ReadonlyArray($.Number), $.Array($.String)))],
        body: function*({ items }) {
          return $.index(items, 0)
        },
      })
    }),
  },
  readonlyUnionForOf: {
    ambient: "declare function fail(): never;",
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("items", $.Union($.ReadonlyArray($.Number), $.Array($.String)))],
        body: function*({ items }) {
          yield* $.forOf("item", items, function*(item) {
            yield* $.return(item)
          })
          return $.call($.hostValue<() => never>("fail"))
        },
      })
    }),
  },
  readonlyUnionWrite: {
    diagnostics: [2322],
    program: $.build(function*() {
      const items = yield* $.let(
        "items",
        $.call($.hostValue<() => never>("fail")),
        $.Union($.ReadonlyArray($.Number), $.Array($.Number)),
      )
      // @ts-expect-error a possibly-readonly receiver cannot be written
      yield* $.assign($.index(items, 0), 1)
      return yield* $.const("actual", 0)
    }),
    ambient: "declare function fail(): never;",
  },
  guardReadonlyArray: guarded($.ReadonlyArray($.Number), (input) => $.isArray(input)),
  guardReadonlyUnionArray: guarded($.Union($.ReadonlyArray($.Number), $.String), (input) => $.isArray(input)),
  guardMixedReadonlyArray: guarded(
    $.Union($.ReadonlyArray($.Number), $.Array($.String), $.Null),
    (input) => $.isArray(input),
  ),
  guardAndMixedReadonlyArray: guarded(
    $.Union($.ReadonlyArray($.Number), $.Array($.String), $.Null),
    (input) => $.allOf($.isArray(input), $.notNullish(input)),
  ),
  guardUnknownFunction: guarded($.Unknown, (input) => $.isTypeof(input, "function")),
  guardObjectFunction: guarded($.NonPrimitive, (input) => $.isTypeof(input, "function")),
  guardRecordFunction: guarded(row, (input) => $.isTypeof(input, "function")),
  guardUnionFunction: guarded($.Union($.Function([$.Number], $.String), $.String, row), (input) => $.isTypeof(input, "function")),
  guardBroadUnionFunction: guarded($.Union($.NonPrimitive, $.Function([], $.Number)), (input) => $.isTypeof(input, "function")),
  guardFunctionTypeUnion: guarded(
    $.Union($.External<$.Typeof<unknown, "function">>("Function"), $.Function([], $.Number)),
    (input) => $.isTypeof(input, "function"),
  ),
  guardFunctionObject: guarded($.Function([], $.Number), (input) => $.isTypeof(input, "object")),
  guardFunctionUnionObject: guarded($.Union($.Function([], $.Number), row, $.Null), (input) => $.isTypeof(input, "object")),
  guardAndFunction: guarded($.Unknown, (input) => $.allOf($.isTypeof(input, "function"), $.notNullish(input))),
  guardUnknownInstance: guarded($.Unknown, (input) => $.instanceOf(input, $.hostValue<typeof Date>("Date"), date)),
  guardObjectInstance: guarded($.NonPrimitive, (input) => $.instanceOf(input, $.hostValue<typeof Date>("Date"), date)),
  guardNullableInstance: guarded(
    $.Union(date, $.Null, $.Undefined),
    (input) => $.instanceOf(input, $.hostValue<typeof Date>("Date"), date),
  ),
  guardAbstractInstance: guarded(
    $.Unknown,
    (input) => $.instanceOf(input, $.hostValue<abstract new(...args: any[]) => Date>("Ctor"), date),
    "declare const Ctor: abstract new (...args: any[]) => Date;",
  ),
  guardUnknownPredicate: guarded($.Unknown, (input) => $.predicate(isDate, input, date), datePredicate),
  guardUnknownUnionPredicate: guarded(
    $.Unknown,
    (input) => $.predicate($.hostValue<(value: unknown) => value is string | number>("isScalar"), input, $.Union($.String, $.Number)),
    "declare function isScalar(value: unknown): value is string | number;",
  ),
  guardObjectPredicate: guarded($.NonPrimitive, (input) => $.predicate(isDate, input, date), datePredicate),
  guardUnionPredicate: guarded($.Union(date, $.String, $.Null), (input) => $.predicate(isDate, input, date), datePredicate),
  guardSubtypePredicate: guarded(
    $.Union($.Object({ x: $.Number, extra: $.Boolean }), $.String),
    (input) => $.predicate(isRow, input, row),
    rowPredicate,
  ),
  guardIntersectionPredicate: guarded($.Object({ y: $.String }), (input) => $.predicate(isRow, input, row), rowPredicate),
  guardDisjointPredicate: guarded(
    $.String,
    (input) => $.predicate($.hostValue<(value: unknown) => value is number>("isNumber"), input, $.Number),
    "declare function isNumber(value: unknown): value is number;",
  ),
  guardFilteredPredicate: guarded($.Union(row, $.Object({ y: $.String })), (input) => $.predicate(isRow, input, row), rowPredicate),
  guardAndPredicate: guarded($.Unknown, (input) => $.allOf($.predicate(isDate, input, date), $.notNullish(input)), datePredicate),
  guardPredicateExpression: guarded(
    $.Unknown,
    (input) => $.predicate($.prop($.hostValue<{ isDate: (value: unknown) => value is Date }>("checks"), "isDate"), input, date),
    "declare const checks: { isDate(value: unknown): value is Date };",
  ),
  instanceofPrecedence: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("input", $.Unknown)],
        body: function*({ input }) {
          return $.not($.binary("instanceof", input, $.hostValue<typeof Date>("Date")))
        },
      })
    }),
  },
  nullLiteral: {
    program: $.build(function*() {
      return yield* $.const("actual", $.null())
    }),
  },
  guardUnknownString: guarded($.Unknown, (input) => $.isTypeof(input, "string")),
  guardUnknownNumber: guarded($.Unknown, (input) => $.isTypeof(input, "number")),
  guardUnknownBoolean: guarded($.Unknown, (input) => $.isTypeof(input, "boolean")),
  guardUnknownBigint: guarded($.Unknown, (input) => $.isTypeof(input, "bigint")),
  guardUnknownSymbol: guarded($.Unknown, (input) => $.isTypeof(input, "symbol")),
  guardUnknownUndefined: guarded($.Unknown, (input) => $.isTypeof(input, "undefined")),
  guardUnknownObject: guarded($.Unknown, (input) => $.isTypeof(input, "object")),
  guardUnknownNotNullish: guarded($.Unknown, (input) => $.notNullish(input)),
  guardUnknownArray: guarded($.Unknown, (input) => $.isArray(input)),
  guardUnionString: guarded($.Union($.Literal("yes"), $.Number), (input) => $.isTypeof(input, "string")),
  guardUnionNumber: guarded($.Union($.String, $.Literal(42)), (input) => $.isTypeof(input, "number")),
  guardUnionBoolean: guarded($.Union($.String, $.Boolean), (input) => $.isTypeof(input, "boolean")),
  guardUnionBigint: guarded($.Union($.String, $.BigInt), (input) => $.isTypeof(input, "bigint")),
  guardUnionSymbol: guarded($.Union($.String, $.Symbol), (input) => $.isTypeof(input, "symbol")),
  guardUnionUndefined: guarded($.Union($.String, $.Undefined), (input) => $.isTypeof(input, "undefined")),
  guardUnionObject: guarded($.Union($.String, $.Object({ x: $.Number }), $.Null), (input) => $.isTypeof(input, "object")),
  guardUnionNotNullish: guarded($.Union($.String, $.Null, $.Undefined), (input) => $.notNullish(input)),
  guardUnionArray: guarded($.Union($.Array($.Number), $.String, $.Null), (input) => $.isArray(input)),
  guardTupleUnionArray: guarded(
    $.Union($.Tuple($.Number, $.String), $.Array($.Boolean), $.Number),
    (input) => $.isArray(input),
  ),
  guardUnknownUnionString: guarded($.Union($.Unknown, $.Number), (input) => $.isTypeof(input, "string")),
  guardUnknownUnionObject: guarded($.Union($.Unknown, $.Object({ x: $.Number })), (input) => $.isTypeof(input, "object")),
  guardUnknownUnionNotNullish: guarded($.Union($.Unknown, $.Number), (input) => $.notNullish(input)),
  guardObjectUnionString: guarded($.Union($.String, $.Object({ x: $.Number })), (input) => $.isTypeof(input, "string")),
  guardArrayUnionString: guarded($.Union($.String, $.Array($.Number)), (input) => $.isTypeof(input, "string")),
  guardBroadObject: guarded($.NonPrimitive, (input) => $.isTypeof(input, "object")),
  guardBroadObjectString: guarded($.NonPrimitive, (input) => $.isTypeof(input, "string")),
  guardVoidNotNullish: guarded($.Void, (input) => $.notNullish(input)),
  guardAndUnknownObject: guarded($.Unknown, (input) => $.allOf($.isTypeof(input, "object"), $.notNullish(input))),
  guardAndReverseObject: guarded(
    $.Union($.NonPrimitive, $.Null, $.String),
    (input) => $.allOf($.notNullish(input), $.isTypeof(input, "object")),
  ),
  guardAndString: guarded(
    $.Union($.Literal("yes"), $.Number, $.Null),
    (input) => $.allOf($.isTypeof(input, "string"), $.notNullish(input)),
  ),
  guardAndArray: guarded($.Unknown, (input) => $.allOf($.isArray(input), $.notNullish(input))),
  guardAndNested: guarded(
    $.Unknown,
    (input) => $.allOf($.isTypeof(input, "object"), $.allOf($.notNullish(input), $.notNullish(input))),
  ),
  guardHasOwnObject: guarded($.NonPrimitive, (input) => $.hasOwn(input, "value")),
  guardHasOwnKnown: guarded($.Object({ value: $.Optional($.Number) }), (input) => $.hasOwn(input, "value")),
  guardHasOwnArray: guarded($.Array($.Number), (input) => $.hasOwn(input, "0")),
  guardInObject: guarded($.NonPrimitive, (input) => $.in(input, "value")),
  guardInUnlisted: guarded($.Object({ x: $.Number }), (input) => $.in(input, "value")),
  guardInUnion: guarded($.Union($.Object({ a: $.Number }), $.Object({ b: $.String })), (input) => $.in(input, "a")),
  guardInOptional: guarded(
    $.Union($.Object({ a: $.Optional($.Number) }), $.Object({ b: $.String })),
    (input) => $.in(input, "a"),
  ),
  guardInUnlistedUnion: guarded($.Union($.Object({ a: $.Number }), $.Object({ b: $.String })), (input) => $.in(input, "value")),
  guardOwnAndIn: guarded($.NonPrimitive, (input) => $.allOf($.hasOwn(input, "value"), $.in(input, "value"))),
  guardInAndOwn: guarded($.NonPrimitive, (input) => $.allOf($.in(input, "value"), $.hasOwn(input, "value"))),
  guardInAndIn: guarded($.NonPrimitive, (input) => $.allOf($.in(input, "first"), $.in(input, "second"))),
  guardInAndKnownUnion: guarded(
    $.Union($.Object({ a: $.Number }), $.Object({ b: $.String })),
    (input) => $.allOf($.in(input, "value"), $.in(input, "a")),
  ),
  guardInAndTypeof: guarded($.NonPrimitive, (input) => $.allOf($.in(input, "value"), $.isTypeof(input, "object"))),
  guardDiscriminant: guarded(
    $.Union(
      $.Object({ kind: $.Literal("text"), value: $.String }),
      $.Object({ kind: $.Literal("number"), value: $.Number }),
      $.Object({ kind: $.Literal("empty") }),
    ),
    (input) => $.isEq(input, "kind", "text"),
  ),
  guardDiscriminantBoolean: guarded(
    $.Union($.Object({ ok: $.Literal(true) }), $.Object({ ok: $.Literal(false) })),
    (input) => $.isEq(input, "ok", true),
  ),
  guardAndDiscriminant: guarded(
    $.Union($.Object({ kind: $.Literal("a") }), $.Object({ kind: $.Literal("b") })),
    (input) => $.allOf($.isTypeof(input, "object"), $.isEq(input, "kind", "a")),
  ),
  guardAndSameDiscriminant: guarded(
    $.Union($.Object({ kind: $.Literal("a") }), $.Object({ kind: $.Literal("b") })),
    (input) => $.allOf($.isEq(input, "kind", "a"), $.isEq(input, "kind", "a")),
  ),
  guardInAndDiscriminant: guarded(
    $.Union($.Object({ kind: $.Literal("a") }), $.Object({ kind: $.Literal("b") })),
    (input) => $.allOf($.in(input, "value"), $.isEq(input, "kind", "a")),
  ),
  guardCheckedProperty: {
    program: $.build(function*() {
      const fn = yield* $.fn("guarded", {
        params: [$.param("input", $.NonPrimitive)],
        body: function*({ input }) {
          const present = yield* $.guard($.in(input, "value"), function*() {
            yield* $.throw("missing value")
          })
          return yield* $.guard($.isTypeof($.prop(present, "value"), "string"), function*() {
            yield* $.throw("not a string")
          })
        },
      })
      return yield* $.const("actual", $.call(fn, $.object({ value: "yes" })))
    }),
  },
  guardClauseAlias: {
    program: $.build(function*() {
      const fn = yield* $.fn("guarded", {
        params: [$.param("input", $.Unknown)],
        body: function*({ input }) {
          const value = yield* $.guard($.allOf($.isTypeof(input, "object"), $.notNullish(input)), function*() {
            yield* $.return(false)
          }, "value")
          return value
        },
      })
      return yield* $.const("actual", $.call(fn, $.object({})))
    }),
  },
  guardClauseThrow: {
    program: $.build(function*() {
      const fn = yield* $.fn("guarded", {
        params: [$.param("input", $.Unknown)],
        body: function*({ input }) {
          return yield* $.guard($.isTypeof(input, "string"), function*() {
            yield* $.throw("not a string")
          })
        },
      })
      return yield* $.const("actual", $.call(fn, $.string("yes")))
    }),
  },
  objectPrimitiveLogical: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("input", $.NonPrimitive)],
        body: function*({ input }) {
          return $.and(input, "yes")
        },
      })
    }),
  },
  assignLiteralObject: {
    ambient: "declare const obj: { x: { ok: true } };",
    program: $.build(function*() {
      yield* $.assign($.prop($.hostValue<{ x: { ok: true } }>("obj"), "x"), { ok: true })
      return yield* $.const("actual", 1)
    }),
  },
  callLiteralObject: {
    ambient: "declare function consume(v: { ok: true }): number;",
    program: $.build(function*() {
      return yield* $.const("actual", $.call($.hostValue<(v: { ok: true }) => number>("consume"), $.object({ ok: true })))
    }),
  },
  callLiteralArray: {
    ambient: "declare function consume(v: { ok: true }[]): number;",
    program: $.build(function*() {
      return yield* $.const("actual", $.call($.hostValue<(v: { ok: true }[]) => number>("consume"), $.array($.object({ ok: true }))))
    }),
  },
  callConditionalObject: {
    ambient: "declare const condition: boolean; declare function consume(v: { ok: true }): number;",
    program: $.build(function*() {
      const choice = $.cond($.hostValue<boolean>("condition"), $.object({ ok: true }), $.object({ ok: true }))
      return yield* $.const("actual", $.call($.hostValue<(v: { ok: true }) => number>("consume"), choice))
    }),
  },
  mappedAliasCapture: {
    program: $.build(function*() {
      yield* $.const("A", 0)
      const a = yield* $.type("A", $.Number)
      const m = yield* $.type("M", $.Mapped("A_2", $.Object({ a: $.String }), a))
      return yield* $.const("actual", { a: 1 }, m)
    }),
  },
  inferGenericAliasCapture: {
    program: $.build(function*() {
      yield* $.const("A", 0)
      const a = yield* $.type("A", {
        params: [$.TypeParam("T")],
        body: ({ T }) => $.Array(T),
      })
      yield* $.type("M", $.Conditional($.String, $.Infer("A_2"), $.Apply(a, [$.Number]), $.Never))
      return yield* $.const("actual", 1)
    }),
  },
  failedArrowNumericRecord: {
    diagnostics: [2322],
    program: $.build(function*() {
      const bad = $.arrow({
        returns: $.String,
        body: function*() {
          return 1
        },
      })
      // @ts-expect-error the failure brand cannot be erased into a numeric record
      const candidate: Record<string, number> = bad ?? {}
      return yield* $.const("actual", candidate)
    }),
  },
  failedArrowNeverRecord: {
    diagnostics: [2322],
    program: $.build(function*() {
      const bad = $.arrow({
        returns: $.String,
        body: function*() {
          return 1
        },
      })
      // @ts-expect-error the failure brand cannot be erased into a never record
      const candidate: Record<string, never> = bad ?? {}
      return yield* $.const("actual", candidate)
    }),
  },
  explicitEmptyObject: {
    program: $.build(function*() {
      return yield* $.const("actual", $.object({}))
    }),
  },
  explicitNestedEmptyObject: {
    program: $.build(function*() {
      return yield* $.const("actual", { nested: $.object({}), values: [$.object({})] })
    }),
  },
  failedArrowNullishFallback: {
    diagnostics: [2322],
    program: $.build(function*() {
      const bad = $.arrow({
        returns: $.String,
        body: function*() {
          return 1
        },
      })
      const candidate = bad ?? {}
      // @ts-expect-error the erased object type cannot conceal an invalid arrow
      return yield* $.const("actual", candidate)
    }),
  },
  failedArrowConditionalFallback: {
    diagnostics: [2322],
    program: $.build(function*() {
      const bad = $.arrow({
        returns: $.String,
        body: function*() {
          return 1
        },
      })
      const candidate = (Math.random() < 2 ? bad : {}) ?? {}
      // @ts-expect-error conditional common-type inference cannot conceal an invalid arrow
      return yield* $.const("actual", candidate)
    }),
  },
  failedArrowArrayCommonType: {
    ambient: "declare function consume(...values: {}[]): void;",
    diagnostics: [2322],
    program: $.build(function*() {
      const bad = $.arrow({
        returns: $.String,
        body: function*() {
          return 1
        },
      })
      const args = [bad, {}].filter((value) => value !== undefined)
      // @ts-expect-error array common-type inference cannot conceal an invalid arrow
      const call = $.call($.hostValue<(...values: {}[]) => void>("consume"), ...args)
      return yield* $.const("actual", call)
    }),
  },
  unionReceiverPropertyWrite: {
    ambient: "declare const obj: { a: number; b: string } | { a: string; b: number };",
    program: $.build(function*() {
      const key: "a" | "b" = Math.random() < 2 ? "a" : "b"
      yield* $.assign($.prop($.hostValue<{ a: number; b: string } | { a: string; b: number }>("obj"), key), 1)
      return yield* $.const("actual", 1)
    }),
  },
  unionReceiverOtherPropertyWrite: {
    ambient: "declare const obj: { a: number; b: string } | { a: string; b: number };",
    program: $.build(function*() {
      const key: "a" | "b" = Math.random() < 0 ? "a" : "b"
      yield* $.assign($.prop($.hostValue<{ a: number; b: string } | { a: string; b: number }>("obj"), key), "x")
      return yield* $.const("actual", 1)
    }),
  },
  optionalTupleWrite: {
    ambient: "declare const tuple: [number?];",
    diagnostics: [2322],
    program: $.build(function*() {
      // @ts-expect-error implicit undefined is not writable under exactOptionalPropertyTypes
      yield* $.assign($.index($.hostValue<[number?]>("tuple"), 0), $.hostValue<undefined>("undefined"))
      return yield* $.const("actual", 1)
    }),
  },
  optionalTupleNumberWrite: {
    ambient: "declare const tuple: [number?];",
    program: $.build(function*() {
      yield* $.assign($.index($.hostValue<[number?]>("tuple"), 0), 1)
      return yield* $.const("actual", 1)
    }),
  },
  optionalTupleExplicitUndefinedWrite: {
    ambient: "declare const tuple: [(number | undefined)?];",
    program: $.build(function*() {
      yield* $.assign($.index($.hostValue<[(number | undefined)?]>("tuple"), 0), $.hostValue<undefined>("undefined"))
      return yield* $.const("actual", 1)
    }),
  },
  absentLiteralReturnAnnotation: {
    program: $.build(function*() {
      const returns = Math.random() < 2 ? undefined : $.Literal("A")
      return yield* $.fn("actual", {
        returns,
        body: function*() {
          return "A"
        },
      })
    }),
  },
  absentObjectReturnAnnotation: {
    program: $.build(function*() {
      const returns = Math.random() < 2 ? undefined : $.Object({ ok: $.Literal(true) })
      const fn = yield* $.fn("fn", {
        returns,
        body: function*() {
          return { ok: true }
        },
      })
      return yield* $.const("actual", $.call(fn), $.Object({ ok: $.Boolean }))
    }),
  },
  optionalBroadReturnAnnotation: {
    program: $.build(function*() {
      const returns = Math.random() < 2 ? undefined : $.Number
      return yield* $.fn("actual", {
        returns,
        body: function*() {
          return 1
        },
      })
    }),
  },
  recursiveRecord: {
    ambient: "type Tree = { value: number; children: Tree[] }; declare function count(tree: Tree): number;",
    program: $.build(function*() {
      return yield* $.const("actual", $.call($.hostValue<(tree: Tree) => number>("count"), tree))
    }),
  },
  optionalNormalizedWrite: {
    diagnostics: [2412],
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("b", $.Boolean)],
        body: function*({ b }) {
          const x = yield* $.const("x", $.cond(b, { a: 1 }, { b: 2 }))
          // @ts-expect-error optional reads include undefined, but writes do not
          yield* $.assign($.prop(x, "a"), $.hostValue<undefined>("undefined"))
          return x
        },
      })
    }),
  },
  tupleUnionWrite: {
    diagnostics: [2322],
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("tuple", $.Tuple($.Number, $.String)), $.param("i", $.Union($.Literal(0), $.Literal(1)))],
        body: function*({ tuple, i }) {
          // @ts-expect-error a finite-union tuple write must satisfy every selected position
          yield* $.assign($.index(tuple, i), 1)
          return tuple
        },
      })
    }),
  },
  symbolLogical: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("x", $.Symbol)],
        body: function*({ x }) {
          return $.and(x, "yes")
        },
      })
    }),
  },
  symbolLogicalOr: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("x", $.Symbol)],
        body: function*({ x }) {
          return $.or(x, "unreachable")
        },
      })
    }),
  },
  stableLogicalCopy: {
    program: $.build(function*() {
      const left = yield* $.const("left", false, $.Literal(false))
      const selected = yield* $.const("selected", $.and(left, "unreachable"))
      return yield* $.let("actual", selected)
    }),
  },
  stableTruthyLogicalCopy: {
    program: $.build(function*() {
      const left = yield* $.const("left", "selected", $.Literal("selected"))
      const selected = yield* $.const("selected", $.or(left, "unreachable"))
      return yield* $.let("actual", selected)
    }),
  },
  selectedLogicalCopy: {
    program: $.build(function*() {
      const left = yield* $.const("left", false, $.Literal(false))
      const selected = yield* $.const("selected", $.or(left, "reachable"))
      return yield* $.let("actual", selected)
    }),
  },
  tupleBoundIndex: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("tuple", $.Tuple($.Number, $.String))],
        body: function*({ tuple }) {
          const i = yield* $.const("i", 0)
          return $.index(tuple, i)
        },
      })
    }),
  },
  tupleAnnotatedIndex: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("tuple", $.Tuple($.Number, $.String)), $.param("i", $.Literal(1))],
        body: function*({ tuple, i }) {
          return $.index(tuple, i)
        },
      })
    }),
  },
  tupleUnionIndex: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("tuple", $.Tuple($.Number, $.String)), $.param("i", $.Union($.Literal(0), $.Literal(1)))],
        body: function*({ tuple, i }) {
          return $.index(tuple, i)
        },
      })
    }),
  },
  objectConditionalBinding: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("b", $.Boolean)],
        body: function*({ b }) {
          return yield* $.const("x", $.cond(b, { a: 1 }, { b: 2 }))
        },
      })
    }),
  },
  objectConditionalLet: {
    ambient: "declare const condition: boolean;",
    program: $.build(function*() {
      return yield* $.let("actual", $.cond($.hostValue<boolean>("condition"), { a: 1 }, { b: 2 }))
    }),
  },
  objectConditionalField: {
    ambient: "declare const condition: boolean;",
    program: $.build(function*() {
      return yield* $.const("actual", { choice: $.cond($.hostValue<boolean>("condition"), { a: 1 }, { b: 2 }) })
    }),
  },
  objectArrayUnion: {
    program: $.build(function*() {
      return yield* $.const("actual", [{ a: 1 }, { b: 2 }])
    }),
  },
  mixedObjectConditional: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("b", $.Boolean), $.param("a", $.Object({ a: $.Number }))],
        body: function*({ b, a }) {
          return yield* $.const("x", $.cond(b, a, { b: 2 }))
        },
      })
    }),
  },
  mixedObjectReturns: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("b", $.Boolean), $.param("a", $.Object({ a: $.Number }))],
        body: function*({ b, a }) {
          yield* $.if(b, function*() {
            yield* $.return(a)
          })
          return { b: 2 }
        },
      })
    }),
  },
  mixedThreeObjectReturns: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("b", $.Boolean), $.param("c", $.Boolean), $.param("a", $.Object({ a: $.Number }))],
        body: function*({ b, c, a }) {
          yield* $.if(b, function*() {
            yield* $.return(a)
          })
          yield* $.if(c, function*() {
            yield* $.return({ b: 2 })
          })
          return { c: 3 }
        },
      })
    }),
  },
  annotatedUnknownArrow: {
    program: $.build(function*() {
      return yield* $.const(
        "actual",
        $.arrow({
          returns: $.Unknown,
          body: function*() {
            return "A"
          },
        }),
      )
    }),
  },
  annotatedUnknownFunction: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        returns: $.Unknown,
        body: function*() {
          return "A"
        },
      })
    }),
  },
  annotatedAnyArrow: {
    program: $.build(function*() {
      return yield* $.const(
        "actual",
        $.arrow({
          returns: $.Any,
          body: function*() {
            return "A"
          },
        }),
      )
    }),
  },
  annotatedUndefinedFunction: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        returns: $.Undefined,
        body: function*() {
          return $.hostValue<undefined>("undefined")
        },
      })
    }),
  },
  bigintLogical: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("x", $.BigInt)],
        body: function*({ x }) {
          return $.and(x, "yes")
        },
      })
    }),
  },
  bigintLogicalOr: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("x", $.BigInt)],
        body: function*({ x }) {
          return $.or(x, "yes")
        },
      })
    }),
  },
  zeroBigintLogical: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("x", $.Literal(0n))],
        body: function*({ x }) {
          return $.and(x, "yes")
        },
      })
    }),
  },
  badArrowArgument: {
    ambient: "declare function consume(x: (string | number)[]): void;",
    diagnostics: [2345, 2322],
    program: $.build(function*() {
      const bad = $.arrow({
        returns: $.String,
        body: function*() {
          return 1
        },
      })
      // @ts-expect-error failed arrow diagnostics cannot be used as call arguments
      return yield* $.const("actual", $.call($.hostValue<(x: (string | number)[]) => void>("consume"), bad))
    }),
  },
  rawObject: {
    expression: rawObject,
    program: $.build(function*() {
      return yield* $.const("actual", rawObject)
    }),
  },
  letLiteral: {
    program: $.build(function*() {
      return yield* $.let("actual", 1)
    }),
  },
  constLiteral: {
    program: $.build(function*() {
      return yield* $.const("actual", 1)
    }),
  },
  freshCopy: {
    program: $.build(function*() {
      const c = yield* $.const("c", "a")
      return yield* $.let("actual", c)
    }),
  },
  stableCopy: {
    program: $.build(function*() {
      const c = yield* $.const("c", "a", $.Literal("a"))
      return yield* $.let("actual", c)
    }),
  },
  constObject: {
    program: $.build(function*() {
      return yield* $.const("actual", { a: 1 })
    }),
  },
  letObject: {
    program: $.build(function*() {
      return yield* $.let("actual", { a: 1 })
    }),
  },
  nestedRawObject: {
    program: $.build(function*() {
      return yield* $.const("actual", $.prop($.prop({ inner: { a: 1 } }, "inner"), "a"))
    }),
  },
  stableObjectField: {
    program: $.build(function*() {
      const field = yield* $.const("field", "a", $.Literal("a"))
      return yield* $.const("actual", $.prop({ field }, "field"))
    }),
  },
  contextualObjectReturn: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        returns: $.Object({ ok: $.Literal(true) }),
        body: function*() {
          return { ok: true }
        },
      })
    }),
  },
  contextualObjectBinding: {
    program: $.build(function*() {
      return yield* $.const("actual", { ok: true }, $.Object({ ok: $.Literal(true) }))
    }),
  },
  rawProperty: {
    program: $.build(function*() {
      return yield* $.const("actual", $.prop(rawObject, "a"))
    }),
  },
  loneReturn: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        body: function*() {
          return "A"
        },
      })
    }),
  },
  nodeReturns: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("b", $.Boolean)],
        body: function*({ b }) {
          yield* $.if(b, function*() {
            yield* $.return("A")
          })
          return $.string("B")
        },
      })
    }),
  },
  plainReturns: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("b", $.Boolean)],
        body: function*({ b }) {
          yield* $.if(b, function*() {
            yield* $.return("A")
          })
          return "B"
        },
      })
    }),
  },
  arrowReturns: {
    program: $.build(function*() {
      return yield* $.const(
        "actual",
        $.arrow({
          params: [$.param("b", $.Boolean)],
          body: function*({ b }) {
            yield* $.if(b, function*() {
              yield* $.return("A")
            })
            return "B"
          },
        }),
      )
    }),
  },
  nestedFunction: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        body: function*() {
          yield* $.fn("inner", {
            body: function*() {
              return "inner"
            },
          })
          return 1
        },
      })
    }),
  },
  objectReturns: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("b", $.Boolean)],
        body: function*({ b }) {
          yield* $.if(b, function*() {
            yield* $.return({ a: 1 })
          })
          return { b: 2 }
        },
      })
    }),
  },
  threeObjectReturns: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("a", $.Boolean), $.param("b", $.Boolean)],
        body: function*({ a, b }) {
          yield* $.if(a, function*() {
            yield* $.return({ a: 1 })
          })
          yield* $.if(b, function*() {
            yield* $.return({ b: "b" })
          })
          return { c: true }
        },
      })
    }),
  },
  conditionalObjectReturn: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("b", $.Boolean)],
        body: function*({ b }) {
          return $.cond(b, { a: 1 }, { b: 2 })
        },
      })
    }),
  },
  objectRefReturns: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        params: [$.param("b", $.Boolean), $.param("a", $.Object({ a: $.Number })), $.param("c", $.Object({ c: $.Number }))],
        body: function*({ b, a, c }) {
          yield* $.if(b, function*() {
            yield* $.return(a)
          })
          return c
        },
      })
    }),
  },
  contextualBinding: {
    program: $.build(function*() {
      return yield* $.const(
        "actual",
        $.arrow({
          body: function*() {
            return "A"
          },
        }),
        $.Function([], $.String),
      )
    }),
  },
  mixedArray: {
    program: $.build(function*() {
      return yield* $.const("actual", ["a", 1])
    }),
  },
  stableArray: {
    program: $.build(function*() {
      const c = yield* $.const("c", "a", $.Literal("a"))
      return yield* $.const("actual", [c])
    }),
  },
  emptyReturn: {
    program: $.build(function*() {
      return yield* $.fn("actual", {
        body: function*() {
          return emptyArray
        },
      })
    }),
  },
  emptyField: {
    program: $.build(function*() {
      return yield* $.const("actual", { values: emptyArray })
    }),
  },
  emptyInitializer: {
    program: $.build(function*() {
      return yield* $.const("actual", [], $.Array($.String))
    }),
  },
  arithmetic: {
    program: $.build(function*() {
      return yield* $.const("actual", $.mod($.div($.mul($.sub($.add(1, 2), 3), 4), 5), 6))
    }),
  },
  concatenation: {
    program: $.build(function*() {
      return yield* $.const("actual", $.add("x", 1))
    }),
  },
  bigintArithmetic: {
    ambient: "declare const a: bigint; declare const b: bigint;",
    program: $.build(function*() {
      return yield* $.const("actual", $.add($.hostValue<bigint>("a"), $.hostValue<bigint>("b")))
    }),
  },
  symbolAddition: {
    ambient: "declare const symbolValue: symbol;",
    diagnostics: [2469],
    program: $.build(function*() {
      // @ts-expect-error stage 1 now rejects this, and the native diagnostic remains a control
      return yield* $.const("actual", $.add("x", $.hostValue<symbol>("symbolValue")))
    }),
  },
  incomparableEquality: {
    diagnostics: [2367],
    program: $.build(function*() {
      // @ts-expect-error stage 1 now rejects this, and the native diagnostic remains a control
      return yield* $.const("actual", $.eq(1, "x"))
    }),
  },
  constLogical: {
    program: $.build(function*() {
      return yield* $.const("actual", $.and(false, "b"))
    }),
  },
  letLogical: {
    program: $.build(function*() {
      return yield* $.let("actual", $.and(false, "b"))
    }),
  },
  stableFalsyLogical: {
    program: $.build(function*() {
      const left = yield* $.const("left", false, $.Literal(false))
      return yield* $.let("actual", $.and(left, "unreachable"))
    }),
  },
  freshTruthyLogical: {
    program: $.build(function*() {
      const left = yield* $.const("left", true)
      return yield* $.let("actual", $.and(left, "b"))
    }),
  },
  stableTruthyLogical: {
    program: $.build(function*() {
      const left = yield* $.const("left", true, $.Literal(true))
      const right = yield* $.const("right", "b", $.Literal("b"))
      return yield* $.let("actual", $.and(left, right))
    }),
  },
  freshOrLogical: {
    program: $.build(function*() {
      const left = yield* $.const("left", false)
      return yield* $.let("actual", $.or(left, "b"))
    }),
  },
  arrayIndex: {
    program: $.build(function*() {
      const xs = yield* $.const("xs", [1])
      return yield* $.const("actual", $.index(xs, 0))
    }),
  },
  tupleIndex: {
    ambient: "declare const tuple: [number, string];",
    program: $.build(function*() {
      return yield* $.const("actual", $.index($.hostValue<[number, string]>("tuple"), 0))
    }),
  },
  dynamicTupleIndex: {
    ambient: "declare const tuple: [number, string]; declare const i: number;",
    program: $.build(function*() {
      return yield* $.const("actual", $.index($.hostValue<[number, string]>("tuple"), $.hostValue<number>("i")))
    }),
  },
} satisfies Readonly<Record<string, ExactCase>>

const contextualRestriction = function*() {
  const literalArrow = $.arrow({
    body: function*() {
      return "A"
    },
  })
  // @ts-expect-error independently built arrows have no later contextual typing; the stricter rejection is intentional
  $.const("actual", literalArrow, $.Function([], $.Literal("A")))
  // @ts-expect-error unannotated evolving-array initializers are rejected rather than modeled
  const evolving = yield* $.const("actual", [])
  // @ts-expect-error stage 1 does not implement TypeScript's flow-sensitive evolving array writes
  $.assign($.index(evolving, 0), 1)
}
void contextualRestriction

const nativeContextual: () => "A" = () => "A"
function nativeEvolving() {
  const values = []
  values.push("a")
  return values
}
const nativeControls: [Equal<ReturnType<typeof nativeContextual>, "A">, Equal<ReturnType<typeof nativeEvolving>, string[]>] = [true, true]
void nativeControls
