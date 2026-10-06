import * as T from "../src/index.ts"
import type { Equal, ExactCase } from "./typing.ts"

export const rawObject = T.objectLiteral({ a: 1 })
export const emptyArray = T.arrayLiteral()

type Tree = { value: number; children: Tree[] }
const tree: Tree = { value: 1, children: [] }

const guarded = <A, Out>(type: T.Type<A>, guard: (input: T.Ref<A, true>) => T.Guard<Out>, ambient: string = "") => {
  let expression: T.Ref<Out, false> | undefined
  const program = T.build(function*() {
    const input = yield* T.let("input", T.call(T.hostValue<() => never>("fail")), type)
    const fn = yield* T.fn("guarded", {
      body: function*() {
        yield* T.ifGuard(guard(input), function*(narrowed) {
          expression = narrowed
          yield* T.return(narrowed)
        })
        return T.call(T.hostValue<() => never>("fail"))
      },
    })
    return yield* T.const("actual", T.call(fn))
  })
  return { ambient: `declare function fail(): never; ${ambient}`, program, expression: expression! }
}

const isDate = T.hostValue<(value: unknown) => value is Date>("isDate")
const date = T.External<Date>("Date")
const datePredicate = "declare function isDate(value: unknown): value is Date;"
const isRow = T.hostValue<(value: unknown) => value is { x: number }>("isRow")
const row = T.Object({ x: T.Number })
const rowPredicate = "declare function isRow(value: unknown): value is { x: number };"

const rejected = <A, Negative>(
  type: T.Type<A>,
  guard: (input: T.Ref<A, true>) => T.Guard<any> & { readonly complement: T.Type<Negative>; readonly complementCheck?: readonly [] },
  ambient: string = "",
  native: boolean = true,
) => {
  let expression: T.Ref<Negative, false> | undefined
  const program = T.build(function*() {
    const input = yield* T.let("input", T.call(T.hostValue<() => never>("fail")), type)
    const value = guard(input)
    const alias = yield* T.fn("alias", {
      body: function*() {
        const builder = T.ifGuard(value, function*() {
          yield* T.throw(0)
        })
        yield* builder.elseGuard(
          function*(rest) {
            expression = rest
            yield* T.return(rest)
          },
          "rest",
        )
        return T.call(T.hostValue<() => never>("fail"))
      },
    })
    const nativeFalse = yield* T.fn("nativeFalse", {
      body: function*() {
        yield* T.if(value.condition, function*() {
          yield* T.throw(0)
        }).pipe(T.else(function*() {
          yield* T.return(input)
        }))
        return T.call(T.hostValue<() => never>("fail"))
      },
    })
    return native ? yield* T.const("actual", T.call(nativeFalse)) : yield* T.const("actual", T.call(alias))
  })
  return { ambient: `declare function fail(): never; ${ambient}`, program, expression: expression! }
}

const optionalRows = T.Union(T.Object({ a: T.Optional(T.Number) }), T.Object({ b: T.String }))
const taggedRows = T.Union(
  T.Object({ kind: T.Literal("a") }),
  T.Object({ kind: T.Literal("b") }),
  T.Object({ kind: T.Literal("c") }),
)

export const cases = {
  elseUnknownTypeof: rejected(T.Unknown, (input) => T.isTypeof(input, "string")),
  elseUnknownNumber: rejected(T.Unknown, (input) => T.isTypeof(input, "number")),
  elseUnknownBoolean: rejected(T.Unknown, (input) => T.isTypeof(input, "boolean")),
  elseUnknownBigint: rejected(T.Unknown, (input) => T.isTypeof(input, "bigint")),
  elseUnknownSymbol: rejected(T.Unknown, (input) => T.isTypeof(input, "symbol")),
  elseUnknownUndefined: rejected(T.Unknown, (input) => T.isTypeof(input, "undefined")),
  elseUnknownObject: rejected(T.Unknown, (input) => T.isTypeof(input, "object")),
  elseUnknownFunction: rejected(T.Unknown, (input) => T.isTypeof(input, "function")),
  elseUnionString: rejected(T.Union(T.Literal("yes"), T.Number, T.Null), (input) => T.isTypeof(input, "string")),
  elseUnionNumber: rejected(T.Union(T.String, T.Number), (input) => T.isTypeof(input, "number")),
  elseUnionBoolean: rejected(T.Union(T.String, T.Boolean), (input) => T.isTypeof(input, "boolean")),
  elseUnionBigint: rejected(T.Union(T.String, T.BigInt), (input) => T.isTypeof(input, "bigint")),
  elseUnionSymbol: rejected(T.Union(T.String, T.Symbol), (input) => T.isTypeof(input, "symbol")),
  elseUnionUndefined: rejected(T.Union(T.String, T.Undefined), (input) => T.isTypeof(input, "undefined")),
  elseUnionObject: rejected(T.Union(row, T.Null, T.String, T.Function([], T.Number)), (input) => T.isTypeof(input, "object")),
  elseUnionFunction: rejected(T.Union(row, T.Function([], T.Number)), (input) => T.isTypeof(input, "function")),
  elseBroadFunction: rejected(T.NonPrimitive, (input) => T.isTypeof(input, "function")),
  elseRecordFunction: rejected(row, (input) => T.isTypeof(input, "function")),
  elseNeverFunction: rejected(T.Function([], T.Number), (input) => T.isTypeof(input, "function")),
  elseUnknownNullish: rejected(T.Unknown, (input) => T.notNullish(input)),
  elseUnionNullish: rejected(T.Union(T.String, T.Null, T.Undefined), (input) => T.notNullish(input)),
  elseVoidNullish: rejected(T.Void, (input) => T.notNullish(input)),
  elseNeverNullish: rejected(row, (input) => T.notNullish(input)),
  elseUnknownArray: rejected(T.Unknown, (input) => T.isArray(input)),
  elseUnionArray: rejected(T.Union(T.Array(T.Number), T.String, T.Null), (input) => T.isArray(input)),
  elseReadonlyArray: rejected(T.ReadonlyArray(T.Number), (input) => T.isArray(input)),
  elseMixedArray: rejected(T.Union(T.ReadonlyArray(T.Number), T.Array(T.String), T.Null), (input) => T.isArray(input)),
  elseTupleArray: rejected(T.Union(T.Tuple(T.Number), T.String), (input) => T.isArray(input)),
  elseEq: rejected(taggedRows, (input) => T.isEq(input, "kind", "a")),
  elseIn: rejected(T.Union(row, T.Object({ y: T.String })), (input) => T.in(input, "x")),
  elseOptionalIn: rejected(optionalRows, (input) => T.in(input, "a")),
  elseUnlistedIn: rejected(optionalRows, (input) => T.in(input, "missing")),
  elseObjectIn: rejected(T.NonPrimitive, (input) => T.in(input, "missing")),
  elseOwn: rejected(optionalRows, (input) => T.hasOwn(input, "a")),
  elseOwnArray: rejected(T.Array(T.Number), (input) => T.hasOwn(input, "0")),
  elseUnknownInstance: rejected(T.Unknown, (input) => T.instanceOf(input, T.hostValue<typeof Date>("Date"), date)),
  elseObjectInstance: rejected(T.NonPrimitive, (input) => T.instanceOf(input, T.hostValue<typeof Date>("Date"), date)),
  elseNullableInstance: rejected(
    T.Union(date, T.Null, T.Undefined),
    (input) => T.instanceOf(input, T.hostValue<typeof Date>("Date"), date),
  ),
  elseUnknownPredicate: rejected(T.Unknown, (input) => T.predicate(isRow, input, row), rowPredicate),
  elseExactInstance: rejected(date, (input) => T.instanceOf(input, T.hostValue<typeof Date>("Date"), date)),
  elseAbstractInstance: rejected(
    T.Unknown,
    (input) => T.instanceOf(input, T.hostValue<abstract new() => Date>("Ctor"), date),
    "declare const Ctor: abstract new () => Date;",
  ),
  elseObjectPredicate: rejected(T.NonPrimitive, (input) => T.predicate(isRow, input, row), rowPredicate),
  elseUnionPredicate: rejected(T.Union(row, T.String, T.Null), (input) => T.predicate(isRow, input, row), rowPredicate),
  elseFilteredPredicate: rejected(T.Union(row, T.Object({ y: T.String })), (input) => T.predicate(isRow, input, row), rowPredicate),
  elseExactPredicate: rejected(row, (input) => T.predicate(isRow, input, row), rowPredicate),
  elseUnknownUnionPredicate: rejected(
    T.Unknown,
    (input) => T.predicate(T.hostValue<(value: unknown) => value is string | number>("isScalar"), input, T.Union(T.String, T.Number)),
    "declare function isScalar(value: unknown): value is string | number;",
  ),
  elseAndUnknown: rejected(T.Unknown, (input) => T.allOf(T.isTypeof(input, "object"), T.notNullish(input))),
  elseAndUnion: rejected(
    T.Union(T.NonPrimitive, T.Null, T.String),
    (input) => T.allOf(T.isTypeof(input, "object"), T.notNullish(input)),
  ),
  elseAndReverse: rejected(
    T.Union(T.NonPrimitive, T.Null, T.String),
    (input) => T.allOf(T.notNullish(input), T.isTypeof(input, "object")),
  ),
  elseAndIn: rejected(optionalRows, (input) => T.allOf(T.in(input, "a"), T.hasOwn(input, "a"))),
  elseAndInTypeof: rejected(T.NonPrimitive, (input) => T.allOf(T.in(input, "value"), T.isTypeof(input, "object"))),
  elseAndEq: rejected(taggedRows, (input) => T.allOf(T.isTypeof(input, "object"), T.isEq(input, "kind", "a"))),
  elseAndArray: rejected(
    T.Union(T.ReadonlyArray(T.Number), T.Array(T.String), T.Null),
    (input) => T.allOf(T.isArray(input), T.notNullish(input)),
  ),
  elseAndNested: rejected(
    T.Unknown,
    (input) => T.allOf(T.isTypeof(input, "object"), T.allOf(T.notNullish(input), T.notNullish(input))),
  ),
  elseAliasNullish: rejected(T.Unknown, (input) => T.notNullish(input), "", false),
  elseAndInstance: rejected(
    T.Unknown,
    (input) => T.allOf(T.instanceOf(input, T.hostValue<typeof Date>("Date"), date), T.notNullish(input)),
  ),
  elseAndPredicate: rejected(T.Unknown, (input) => T.allOf(T.predicate(isRow, input, row), T.notNullish(input)), rowPredicate),
  elseAndReadonlyOwn: rejected(T.ReadonlyArray(T.Number), (input) => T.allOf(T.isArray(input), T.hasOwn(input, "0"))),
  elseAliasMixedArray: rejected(
    T.Union(T.ReadonlyArray(T.Number), T.Array(T.String), T.Null),
    (input) => T.isArray(input),
    "",
    false,
  ),
  elseAliasEq: rejected(taggedRows, (input) => T.isEq(input, "kind", "a"), "", false),
  elseAliasAnd: rejected(
    T.Union(T.NonPrimitive, T.Null, T.String),
    (input) => T.allOf(T.isTypeof(input, "object"), T.notNullish(input)),
    "",
    false,
  ),
  elseAliasDeclarationNarrowing: {
    program: T.build(function*() {
      const fn = yield* T.fn("read", {
        body: function*() {
          const input = yield* T.const("input", T.nullLiteral(), T.Union(T.String, T.Number, T.Null))
          yield* T.ifGuard(T.isTypeof(input, "string"), function*() {
            yield* T.throw(0)
          }).elseGuard(function*(rest) {
            yield* T.return(rest)
          })
          return T.call(T.hostValue<() => never>("fail"))
        },
      })
      return yield* T.const("actual", T.call(fn))
    }),
    ambient: "declare function fail(): never;",
  },
  readonlyArrayAnnotation: {
    program: T.build(function*() {
      return yield* T.const("actual", T.arrayLiteral(1, 2), T.ReadonlyArray(T.Number))
    }),
  },
  readonlyArrayLiteralContext: {
    program: T.build(function*() {
      return yield* T.const("actual", T.arrayLiteral(T.objectLiteral({ ok: true })), T.ReadonlyArray(T.Object({ ok: T.Literal(true) })))
    }),
  },
  readonlyNestedArray: {
    program: T.build(function*() {
      return yield* T.const("actual", [[1]], T.Array(T.ReadonlyArray(T.Number)))
    }),
  },
  readonlyArrayIndex: {
    program: T.build(function*() {
      const items = yield* T.const("items", [1], T.ReadonlyArray(T.Number))
      return yield* T.const("actual", T.index(items, 0))
    }),
  },
  readonlyArrayForOf: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("items", T.ReadonlyArray(T.Literal("yes")))],
        body: function*({ items }) {
          yield* T.forOf("item", items, function*(item) {
            yield* T.return(item)
          })
          return T.call(T.hostValue<() => never>("fail"))
        },
      })
    }),
    ambient: "declare function fail(): never;",
  },
  readonlyArrayWrite: {
    diagnostics: [2542],
    program: T.build(function*() {
      const items = yield* T.const("items", [1], T.ReadonlyArray(T.Number))
      // @ts-expect-error readonly arrays reject index writes
      yield* T.assign(T.index(items, 0), 2)
      return yield* T.const("actual", items)
    }),
  },
  readonlyArrayLengthWrite: {
    diagnostics: [2540],
    program: T.build(function*() {
      const items = yield* T.const("items", [1], T.ReadonlyArray(T.Number))
      // @ts-expect-error readonly array length is readonly too
      yield* T.assign(T.prop(items, "length"), 2)
      return yield* T.const("actual", items)
    }),
  },
  readonlyArraySubstitution: {
    program: T.build(function*() {
      const list = yield* T.type("List", { params: [T.TypeParam("T")], body: ({ T: TParam }) => T.ReadonlyArray(TParam) })
      return yield* T.const("actual", [1], T.Apply(list, [T.Number]))
    }),
  },
  readonlyUnionIndex: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("items", T.Union(T.ReadonlyArray(T.Number), T.Array(T.String)))],
        body: function*({ items }) {
          return T.index(items, 0)
        },
      })
    }),
  },
  readonlyUnionForOf: {
    ambient: "declare function fail(): never;",
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("items", T.Union(T.ReadonlyArray(T.Number), T.Array(T.String)))],
        body: function*({ items }) {
          yield* T.forOf("item", items, function*(item) {
            yield* T.return(item)
          })
          return T.call(T.hostValue<() => never>("fail"))
        },
      })
    }),
  },
  readonlyUnionWrite: {
    diagnostics: [2322],
    program: T.build(function*() {
      const items = yield* T.let(
        "items",
        T.call(T.hostValue<() => never>("fail")),
        T.Union(T.ReadonlyArray(T.Number), T.Array(T.Number)),
      )
      // @ts-expect-error a possibly-readonly receiver cannot be written
      yield* T.assign(T.index(items, 0), 1)
      return yield* T.const("actual", 0)
    }),
    ambient: "declare function fail(): never;",
  },
  guardReadonlyArray: guarded(T.ReadonlyArray(T.Number), (input) => T.isArray(input)),
  guardReadonlyUnionArray: guarded(T.Union(T.ReadonlyArray(T.Number), T.String), (input) => T.isArray(input)),
  guardMixedReadonlyArray: guarded(
    T.Union(T.ReadonlyArray(T.Number), T.Array(T.String), T.Null),
    (input) => T.isArray(input),
  ),
  guardAndMixedReadonlyArray: guarded(
    T.Union(T.ReadonlyArray(T.Number), T.Array(T.String), T.Null),
    (input) => T.allOf(T.isArray(input), T.notNullish(input)),
  ),
  guardUnknownFunction: guarded(T.Unknown, (input) => T.isTypeof(input, "function")),
  guardObjectFunction: guarded(T.NonPrimitive, (input) => T.isTypeof(input, "function")),
  guardRecordFunction: guarded(row, (input) => T.isTypeof(input, "function")),
  guardUnionFunction: guarded(T.Union(T.Function([T.Number], T.String), T.String, row), (input) => T.isTypeof(input, "function")),
  guardBroadUnionFunction: guarded(T.Union(T.NonPrimitive, T.Function([], T.Number)), (input) => T.isTypeof(input, "function")),
  guardFunctionTypeUnion: guarded(
    T.Union(T.External<T.Typeof<unknown, "function">>("Function"), T.Function([], T.Number)),
    (input) => T.isTypeof(input, "function"),
  ),
  guardFunctionObject: guarded(T.Function([], T.Number), (input) => T.isTypeof(input, "object")),
  guardFunctionUnionObject: guarded(T.Union(T.Function([], T.Number), row, T.Null), (input) => T.isTypeof(input, "object")),
  guardAndFunction: guarded(T.Unknown, (input) => T.allOf(T.isTypeof(input, "function"), T.notNullish(input))),
  guardUnknownInstance: guarded(T.Unknown, (input) => T.instanceOf(input, T.hostValue<typeof Date>("Date"), date)),
  guardObjectInstance: guarded(T.NonPrimitive, (input) => T.instanceOf(input, T.hostValue<typeof Date>("Date"), date)),
  guardNullableInstance: guarded(
    T.Union(date, T.Null, T.Undefined),
    (input) => T.instanceOf(input, T.hostValue<typeof Date>("Date"), date),
  ),
  guardAbstractInstance: guarded(
    T.Unknown,
    (input) => T.instanceOf(input, T.hostValue<abstract new(...args: any[]) => Date>("Ctor"), date),
    "declare const Ctor: abstract new (...args: any[]) => Date;",
  ),
  guardUnknownPredicate: guarded(T.Unknown, (input) => T.predicate(isDate, input, date), datePredicate),
  guardUnknownUnionPredicate: guarded(
    T.Unknown,
    (input) => T.predicate(T.hostValue<(value: unknown) => value is string | number>("isScalar"), input, T.Union(T.String, T.Number)),
    "declare function isScalar(value: unknown): value is string | number;",
  ),
  guardObjectPredicate: guarded(T.NonPrimitive, (input) => T.predicate(isDate, input, date), datePredicate),
  guardUnionPredicate: guarded(T.Union(date, T.String, T.Null), (input) => T.predicate(isDate, input, date), datePredicate),
  guardSubtypePredicate: guarded(
    T.Union(T.Object({ x: T.Number, extra: T.Boolean }), T.String),
    (input) => T.predicate(isRow, input, row),
    rowPredicate,
  ),
  guardIntersectionPredicate: guarded(T.Object({ y: T.String }), (input) => T.predicate(isRow, input, row), rowPredicate),
  guardDisjointPredicate: guarded(
    T.String,
    (input) => T.predicate(T.hostValue<(value: unknown) => value is number>("isNumber"), input, T.Number),
    "declare function isNumber(value: unknown): value is number;",
  ),
  guardFilteredPredicate: guarded(T.Union(row, T.Object({ y: T.String })), (input) => T.predicate(isRow, input, row), rowPredicate),
  guardAndPredicate: guarded(T.Unknown, (input) => T.allOf(T.predicate(isDate, input, date), T.notNullish(input)), datePredicate),
  guardPredicateExpression: guarded(
    T.Unknown,
    (input) => T.predicate(T.prop(T.hostValue<{ isDate: (value: unknown) => value is Date }>("checks"), "isDate"), input, date),
    "declare const checks: { isDate(value: unknown): value is Date };",
  ),
  instanceofPrecedence: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("input", T.Unknown)],
        body: function*({ input }) {
          return T.not(T.binary("instanceof", input, T.hostValue<typeof Date>("Date")))
        },
      })
    }),
  },
  nullLiteral: {
    program: T.build(function*() {
      return yield* T.const("actual", T.nullLiteral())
    }),
  },
  guardUnknownString: guarded(T.Unknown, (input) => T.isTypeof(input, "string")),
  guardUnknownNumber: guarded(T.Unknown, (input) => T.isTypeof(input, "number")),
  guardUnknownBoolean: guarded(T.Unknown, (input) => T.isTypeof(input, "boolean")),
  guardUnknownBigint: guarded(T.Unknown, (input) => T.isTypeof(input, "bigint")),
  guardUnknownSymbol: guarded(T.Unknown, (input) => T.isTypeof(input, "symbol")),
  guardUnknownUndefined: guarded(T.Unknown, (input) => T.isTypeof(input, "undefined")),
  guardUnknownObject: guarded(T.Unknown, (input) => T.isTypeof(input, "object")),
  guardUnknownNotNullish: guarded(T.Unknown, (input) => T.notNullish(input)),
  guardUnknownArray: guarded(T.Unknown, (input) => T.isArray(input)),
  guardUnionString: guarded(T.Union(T.Literal("yes"), T.Number), (input) => T.isTypeof(input, "string")),
  guardUnionNumber: guarded(T.Union(T.String, T.Literal(42)), (input) => T.isTypeof(input, "number")),
  guardUnionBoolean: guarded(T.Union(T.String, T.Boolean), (input) => T.isTypeof(input, "boolean")),
  guardUnionBigint: guarded(T.Union(T.String, T.BigInt), (input) => T.isTypeof(input, "bigint")),
  guardUnionSymbol: guarded(T.Union(T.String, T.Symbol), (input) => T.isTypeof(input, "symbol")),
  guardUnionUndefined: guarded(T.Union(T.String, T.Undefined), (input) => T.isTypeof(input, "undefined")),
  guardUnionObject: guarded(T.Union(T.String, T.Object({ x: T.Number }), T.Null), (input) => T.isTypeof(input, "object")),
  guardUnionNotNullish: guarded(T.Union(T.String, T.Null, T.Undefined), (input) => T.notNullish(input)),
  guardUnionArray: guarded(T.Union(T.Array(T.Number), T.String, T.Null), (input) => T.isArray(input)),
  guardTupleUnionArray: guarded(
    T.Union(T.Tuple(T.Number, T.String), T.Array(T.Boolean), T.Number),
    (input) => T.isArray(input),
  ),
  guardUnknownUnionString: guarded(T.Union(T.Unknown, T.Number), (input) => T.isTypeof(input, "string")),
  guardUnknownUnionObject: guarded(T.Union(T.Unknown, T.Object({ x: T.Number })), (input) => T.isTypeof(input, "object")),
  guardUnknownUnionNotNullish: guarded(T.Union(T.Unknown, T.Number), (input) => T.notNullish(input)),
  guardObjectUnionString: guarded(T.Union(T.String, T.Object({ x: T.Number })), (input) => T.isTypeof(input, "string")),
  guardArrayUnionString: guarded(T.Union(T.String, T.Array(T.Number)), (input) => T.isTypeof(input, "string")),
  guardBroadObject: guarded(T.NonPrimitive, (input) => T.isTypeof(input, "object")),
  guardBroadObjectString: guarded(T.NonPrimitive, (input) => T.isTypeof(input, "string")),
  guardVoidNotNullish: guarded(T.Void, (input) => T.notNullish(input)),
  guardAndUnknownObject: guarded(T.Unknown, (input) => T.allOf(T.isTypeof(input, "object"), T.notNullish(input))),
  guardAndReverseObject: guarded(
    T.Union(T.NonPrimitive, T.Null, T.String),
    (input) => T.allOf(T.notNullish(input), T.isTypeof(input, "object")),
  ),
  guardAndString: guarded(
    T.Union(T.Literal("yes"), T.Number, T.Null),
    (input) => T.allOf(T.isTypeof(input, "string"), T.notNullish(input)),
  ),
  guardAndArray: guarded(T.Unknown, (input) => T.allOf(T.isArray(input), T.notNullish(input))),
  guardAndNested: guarded(
    T.Unknown,
    (input) => T.allOf(T.isTypeof(input, "object"), T.allOf(T.notNullish(input), T.notNullish(input))),
  ),
  guardHasOwnObject: guarded(T.NonPrimitive, (input) => T.hasOwn(input, "value")),
  guardHasOwnKnown: guarded(T.Object({ value: T.Optional(T.Number) }), (input) => T.hasOwn(input, "value")),
  guardHasOwnArray: guarded(T.Array(T.Number), (input) => T.hasOwn(input, "0")),
  guardInObject: guarded(T.NonPrimitive, (input) => T.in(input, "value")),
  guardInUnlisted: guarded(T.Object({ x: T.Number }), (input) => T.in(input, "value")),
  guardInUnion: guarded(T.Union(T.Object({ a: T.Number }), T.Object({ b: T.String })), (input) => T.in(input, "a")),
  guardInOptional: guarded(
    T.Union(T.Object({ a: T.Optional(T.Number) }), T.Object({ b: T.String })),
    (input) => T.in(input, "a"),
  ),
  guardInUnlistedUnion: guarded(T.Union(T.Object({ a: T.Number }), T.Object({ b: T.String })), (input) => T.in(input, "value")),
  guardOwnAndIn: guarded(T.NonPrimitive, (input) => T.allOf(T.hasOwn(input, "value"), T.in(input, "value"))),
  guardInAndOwn: guarded(T.NonPrimitive, (input) => T.allOf(T.in(input, "value"), T.hasOwn(input, "value"))),
  guardInAndIn: guarded(T.NonPrimitive, (input) => T.allOf(T.in(input, "first"), T.in(input, "second"))),
  guardInAndKnownUnion: guarded(
    T.Union(T.Object({ a: T.Number }), T.Object({ b: T.String })),
    (input) => T.allOf(T.in(input, "value"), T.in(input, "a")),
  ),
  guardInAndTypeof: guarded(T.NonPrimitive, (input) => T.allOf(T.in(input, "value"), T.isTypeof(input, "object"))),
  guardDiscriminant: guarded(
    T.Union(
      T.Object({ kind: T.Literal("text"), value: T.String }),
      T.Object({ kind: T.Literal("number"), value: T.Number }),
      T.Object({ kind: T.Literal("empty") }),
    ),
    (input) => T.isEq(input, "kind", "text"),
  ),
  guardDiscriminantBoolean: guarded(
    T.Union(T.Object({ ok: T.Literal(true) }), T.Object({ ok: T.Literal(false) })),
    (input) => T.isEq(input, "ok", true),
  ),
  guardAndDiscriminant: guarded(
    T.Union(T.Object({ kind: T.Literal("a") }), T.Object({ kind: T.Literal("b") })),
    (input) => T.allOf(T.isTypeof(input, "object"), T.isEq(input, "kind", "a")),
  ),
  guardAndSameDiscriminant: guarded(
    T.Union(T.Object({ kind: T.Literal("a") }), T.Object({ kind: T.Literal("b") })),
    (input) => T.allOf(T.isEq(input, "kind", "a"), T.isEq(input, "kind", "a")),
  ),
  guardInAndDiscriminant: guarded(
    T.Union(T.Object({ kind: T.Literal("a") }), T.Object({ kind: T.Literal("b") })),
    (input) => T.allOf(T.in(input, "value"), T.isEq(input, "kind", "a")),
  ),
  guardCheckedProperty: {
    program: T.build(function*() {
      const fn = yield* T.fn("guarded", {
        params: [T.param("input", T.NonPrimitive)],
        body: function*({ input }) {
          const present = yield* T.guard(T.in(input, "value"), function*() {
            yield* T.throw("missing value")
          })
          return yield* T.guard(T.isTypeof(T.prop(present, "value"), "string"), function*() {
            yield* T.throw("not a string")
          })
        },
      })
      return yield* T.const("actual", T.call(fn, T.objectLiteral({ value: "yes" })))
    }),
  },
  guardClauseAlias: {
    program: T.build(function*() {
      const fn = yield* T.fn("guarded", {
        params: [T.param("input", T.Unknown)],
        body: function*({ input }) {
          const value = yield* T.guard(T.allOf(T.isTypeof(input, "object"), T.notNullish(input)), function*() {
            yield* T.return(false)
          }, "value")
          return value
        },
      })
      return yield* T.const("actual", T.call(fn, T.objectLiteral({})))
    }),
  },
  guardClauseThrow: {
    program: T.build(function*() {
      const fn = yield* T.fn("guarded", {
        params: [T.param("input", T.Unknown)],
        body: function*({ input }) {
          return yield* T.guard(T.isTypeof(input, "string"), function*() {
            yield* T.throw("not a string")
          })
        },
      })
      return yield* T.const("actual", T.call(fn, T.stringLiteral("yes")))
    }),
  },
  objectPrimitiveLogical: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("input", T.NonPrimitive)],
        body: function*({ input }) {
          return T.and(input, "yes")
        },
      })
    }),
  },
  assignLiteralObject: {
    ambient: "declare const obj: { x: { ok: true } };",
    program: T.build(function*() {
      yield* T.assign(T.prop(T.hostValue<{ x: { ok: true } }>("obj"), "x"), { ok: true })
      return yield* T.const("actual", 1)
    }),
  },
  callLiteralObject: {
    ambient: "declare function consume(v: { ok: true }): number;",
    program: T.build(function*() {
      return yield* T.const("actual", T.call(T.hostValue<(v: { ok: true }) => number>("consume"), T.objectLiteral({ ok: true })))
    }),
  },
  callLiteralArray: {
    ambient: "declare function consume(v: { ok: true }[]): number;",
    program: T.build(function*() {
      return yield* T.const("actual", T.call(T.hostValue<(v: { ok: true }[]) => number>("consume"), T.arrayLiteral(T.objectLiteral({ ok: true }))))
    }),
  },
  callConditionalObject: {
    ambient: "declare const condition: boolean; declare function consume(v: { ok: true }): number;",
    program: T.build(function*() {
      const choice = T.cond(T.hostValue<boolean>("condition"), T.objectLiteral({ ok: true }), T.objectLiteral({ ok: true }))
      return yield* T.const("actual", T.call(T.hostValue<(v: { ok: true }) => number>("consume"), choice))
    }),
  },
  mappedAliasCapture: {
    program: T.build(function*() {
      yield* T.const("A", 0)
      const a = yield* T.type("A", T.Number)
      const m = yield* T.type("M", T.Mapped("A_2", T.Object({ a: T.String }), a))
      return yield* T.const("actual", { a: 1 }, m)
    }),
  },
  inferGenericAliasCapture: {
    program: T.build(function*() {
      yield* T.const("A", 0)
      const a = yield* T.type("A", {
        params: [T.TypeParam("T")],
        body: ({ T: TParam }) => T.Array(TParam),
      })
      yield* T.type("M", T.Conditional(T.String, T.Infer("A_2"), T.Apply(a, [T.Number]), T.Never))
      return yield* T.const("actual", 1)
    }),
  },
  failedArrowNumericRecord: {
    diagnostics: [2322],
    program: T.build(function*() {
      const bad = T.arrow({
        returns: T.String,
        body: function*() {
          return 1
        },
      })
      // @ts-expect-error the failure brand cannot be erased into a numeric record
      const candidate: Record<string, number> = bad ?? {}
      return yield* T.const("actual", candidate)
    }),
  },
  failedArrowNeverRecord: {
    diagnostics: [2322],
    program: T.build(function*() {
      const bad = T.arrow({
        returns: T.String,
        body: function*() {
          return 1
        },
      })
      // @ts-expect-error the failure brand cannot be erased into a never record
      const candidate: Record<string, never> = bad ?? {}
      return yield* T.const("actual", candidate)
    }),
  },
  explicitEmptyObject: {
    program: T.build(function*() {
      return yield* T.const("actual", T.objectLiteral({}))
    }),
  },
  explicitNestedEmptyObject: {
    program: T.build(function*() {
      return yield* T.const("actual", { nested: T.objectLiteral({}), values: [T.objectLiteral({})] })
    }),
  },
  failedArrowNullishFallback: {
    diagnostics: [2322],
    program: T.build(function*() {
      const bad = T.arrow({
        returns: T.String,
        body: function*() {
          return 1
        },
      })
      const candidate = bad ?? {}
      // @ts-expect-error the erased object type cannot conceal an invalid arrow
      return yield* T.const("actual", candidate)
    }),
  },
  failedArrowConditionalFallback: {
    diagnostics: [2322],
    program: T.build(function*() {
      const bad = T.arrow({
        returns: T.String,
        body: function*() {
          return 1
        },
      })
      const candidate = (Math.random() < 2 ? bad : {}) ?? {}
      // @ts-expect-error conditional common-type inference cannot conceal an invalid arrow
      return yield* T.const("actual", candidate)
    }),
  },
  failedArrowArrayCommonType: {
    ambient: "declare function consume(...values: {}[]): void;",
    diagnostics: [2322],
    program: T.build(function*() {
      const bad = T.arrow({
        returns: T.String,
        body: function*() {
          return 1
        },
      })
      const args = [bad, {}].filter((value) => value !== undefined)
      // @ts-expect-error array common-type inference cannot conceal an invalid arrow
      const call = T.call(T.hostValue<(...values: {}[]) => void>("consume"), ...args)
      return yield* T.const("actual", call)
    }),
  },
  unionReceiverPropertyWrite: {
    ambient: "declare const obj: { a: number; b: string } | { a: string; b: number };",
    program: T.build(function*() {
      const key: "a" | "b" = Math.random() < 2 ? "a" : "b"
      yield* T.assign(T.prop(T.hostValue<{ a: number; b: string } | { a: string; b: number }>("obj"), key), 1)
      return yield* T.const("actual", 1)
    }),
  },
  unionReceiverOtherPropertyWrite: {
    ambient: "declare const obj: { a: number; b: string } | { a: string; b: number };",
    program: T.build(function*() {
      const key: "a" | "b" = Math.random() < 0 ? "a" : "b"
      yield* T.assign(T.prop(T.hostValue<{ a: number; b: string } | { a: string; b: number }>("obj"), key), "x")
      return yield* T.const("actual", 1)
    }),
  },
  optionalTupleWrite: {
    ambient: "declare const tuple: [number?];",
    diagnostics: [2322],
    program: T.build(function*() {
      // @ts-expect-error implicit undefined is not writable under exactOptionalPropertyTypes
      yield* T.assign(T.index(T.hostValue<[number?]>("tuple"), 0), T.hostValue<undefined>("undefined"))
      return yield* T.const("actual", 1)
    }),
  },
  optionalTupleNumberWrite: {
    ambient: "declare const tuple: [number?];",
    program: T.build(function*() {
      yield* T.assign(T.index(T.hostValue<[number?]>("tuple"), 0), 1)
      return yield* T.const("actual", 1)
    }),
  },
  optionalTupleExplicitUndefinedWrite: {
    ambient: "declare const tuple: [(number | undefined)?];",
    program: T.build(function*() {
      yield* T.assign(T.index(T.hostValue<[(number | undefined)?]>("tuple"), 0), T.hostValue<undefined>("undefined"))
      return yield* T.const("actual", 1)
    }),
  },
  absentLiteralReturnAnnotation: {
    program: T.build(function*() {
      const returns = Math.random() < 2 ? undefined : T.Literal("A")
      return yield* T.fn("actual", {
        returns,
        body: function*() {
          return "A"
        },
      })
    }),
  },
  absentObjectReturnAnnotation: {
    program: T.build(function*() {
      const returns = Math.random() < 2 ? undefined : T.Object({ ok: T.Literal(true) })
      const fn = yield* T.fn("fn", {
        returns,
        body: function*() {
          return { ok: true }
        },
      })
      return yield* T.const("actual", T.call(fn), T.Object({ ok: T.Boolean }))
    }),
  },
  optionalBroadReturnAnnotation: {
    program: T.build(function*() {
      const returns = Math.random() < 2 ? undefined : T.Number
      return yield* T.fn("actual", {
        returns,
        body: function*() {
          return 1
        },
      })
    }),
  },
  recursiveRecord: {
    ambient: "type Tree = { value: number; children: Tree[] }; declare function count(tree: Tree): number;",
    program: T.build(function*() {
      return yield* T.const("actual", T.call(T.hostValue<(tree: Tree) => number>("count"), tree))
    }),
  },
  optionalNormalizedWrite: {
    diagnostics: [2412],
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("b", T.Boolean)],
        body: function*({ b }) {
          const x = yield* T.const("x", T.cond(b, { a: 1 }, { b: 2 }))
          // @ts-expect-error optional reads include undefined, but writes do not
          yield* T.assign(T.prop(x, "a"), T.hostValue<undefined>("undefined"))
          return x
        },
      })
    }),
  },
  tupleUnionWrite: {
    diagnostics: [2322],
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("tuple", T.Tuple(T.Number, T.String)), T.param("i", T.Union(T.Literal(0), T.Literal(1)))],
        body: function*({ tuple, i }) {
          // @ts-expect-error a finite-union tuple write must satisfy every selected position
          yield* T.assign(T.index(tuple, i), 1)
          return tuple
        },
      })
    }),
  },
  symbolLogical: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("x", T.Symbol)],
        body: function*({ x }) {
          return T.and(x, "yes")
        },
      })
    }),
  },
  symbolLogicalOr: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("x", T.Symbol)],
        body: function*({ x }) {
          return T.or(x, "unreachable")
        },
      })
    }),
  },
  stableLogicalCopy: {
    program: T.build(function*() {
      const left = yield* T.const("left", false, T.Literal(false))
      const selected = yield* T.const("selected", T.and(left, "unreachable"))
      return yield* T.let("actual", selected)
    }),
  },
  stableTruthyLogicalCopy: {
    program: T.build(function*() {
      const left = yield* T.const("left", "selected", T.Literal("selected"))
      const selected = yield* T.const("selected", T.or(left, "unreachable"))
      return yield* T.let("actual", selected)
    }),
  },
  selectedLogicalCopy: {
    program: T.build(function*() {
      const left = yield* T.const("left", false, T.Literal(false))
      const selected = yield* T.const("selected", T.or(left, "reachable"))
      return yield* T.let("actual", selected)
    }),
  },
  tupleBoundIndex: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("tuple", T.Tuple(T.Number, T.String))],
        body: function*({ tuple }) {
          const i = yield* T.const("i", 0)
          return T.index(tuple, i)
        },
      })
    }),
  },
  tupleAnnotatedIndex: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("tuple", T.Tuple(T.Number, T.String)), T.param("i", T.Literal(1))],
        body: function*({ tuple, i }) {
          return T.index(tuple, i)
        },
      })
    }),
  },
  tupleUnionIndex: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("tuple", T.Tuple(T.Number, T.String)), T.param("i", T.Union(T.Literal(0), T.Literal(1)))],
        body: function*({ tuple, i }) {
          return T.index(tuple, i)
        },
      })
    }),
  },
  objectConditionalBinding: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("b", T.Boolean)],
        body: function*({ b }) {
          return yield* T.const("x", T.cond(b, { a: 1 }, { b: 2 }))
        },
      })
    }),
  },
  objectConditionalLet: {
    ambient: "declare const condition: boolean;",
    program: T.build(function*() {
      return yield* T.let("actual", T.cond(T.hostValue<boolean>("condition"), { a: 1 }, { b: 2 }))
    }),
  },
  objectConditionalField: {
    ambient: "declare const condition: boolean;",
    program: T.build(function*() {
      return yield* T.const("actual", { choice: T.cond(T.hostValue<boolean>("condition"), { a: 1 }, { b: 2 }) })
    }),
  },
  objectArrayUnion: {
    program: T.build(function*() {
      return yield* T.const("actual", [{ a: 1 }, { b: 2 }])
    }),
  },
  mixedObjectConditional: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("b", T.Boolean), T.param("a", T.Object({ a: T.Number }))],
        body: function*({ b, a }) {
          return yield* T.const("x", T.cond(b, a, { b: 2 }))
        },
      })
    }),
  },
  mixedObjectReturns: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("b", T.Boolean), T.param("a", T.Object({ a: T.Number }))],
        body: function*({ b, a }) {
          yield* T.if(b, function*() {
            yield* T.return(a)
          })
          return { b: 2 }
        },
      })
    }),
  },
  mixedThreeObjectReturns: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("b", T.Boolean), T.param("c", T.Boolean), T.param("a", T.Object({ a: T.Number }))],
        body: function*({ b, c, a }) {
          yield* T.if(b, function*() {
            yield* T.return(a)
          })
          yield* T.if(c, function*() {
            yield* T.return({ b: 2 })
          })
          return { c: 3 }
        },
      })
    }),
  },
  annotatedUnknownArrow: {
    program: T.build(function*() {
      return yield* T.const(
        "actual",
        T.arrow({
          returns: T.Unknown,
          body: function*() {
            return "A"
          },
        }),
      )
    }),
  },
  annotatedUnknownFunction: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        returns: T.Unknown,
        body: function*() {
          return "A"
        },
      })
    }),
  },
  annotatedAnyArrow: {
    program: T.build(function*() {
      return yield* T.const(
        "actual",
        T.arrow({
          returns: T.Any,
          body: function*() {
            return "A"
          },
        }),
      )
    }),
  },
  annotatedUndefinedFunction: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        returns: T.Undefined,
        body: function*() {
          return T.hostValue<undefined>("undefined")
        },
      })
    }),
  },
  bigintLogical: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("x", T.BigInt)],
        body: function*({ x }) {
          return T.and(x, "yes")
        },
      })
    }),
  },
  bigintLogicalOr: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("x", T.BigInt)],
        body: function*({ x }) {
          return T.or(x, "yes")
        },
      })
    }),
  },
  zeroBigintLogical: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("x", T.Literal(0n))],
        body: function*({ x }) {
          return T.and(x, "yes")
        },
      })
    }),
  },
  badArrowArgument: {
    ambient: "declare function consume(x: (string | number)[]): void;",
    diagnostics: [2345, 2322],
    program: T.build(function*() {
      const bad = T.arrow({
        returns: T.String,
        body: function*() {
          return 1
        },
      })
      // @ts-expect-error failed arrow diagnostics cannot be used as call arguments
      return yield* T.const("actual", T.call(T.hostValue<(x: (string | number)[]) => void>("consume"), bad))
    }),
  },
  rawObject: {
    expression: rawObject,
    program: T.build(function*() {
      return yield* T.const("actual", rawObject)
    }),
  },
  letLiteral: {
    program: T.build(function*() {
      return yield* T.let("actual", 1)
    }),
  },
  constLiteral: {
    program: T.build(function*() {
      return yield* T.const("actual", 1)
    }),
  },
  freshCopy: {
    program: T.build(function*() {
      const c = yield* T.const("c", "a")
      return yield* T.let("actual", c)
    }),
  },
  stableCopy: {
    program: T.build(function*() {
      const c = yield* T.const("c", "a", T.Literal("a"))
      return yield* T.let("actual", c)
    }),
  },
  constObject: {
    program: T.build(function*() {
      return yield* T.const("actual", { a: 1 })
    }),
  },
  letObject: {
    program: T.build(function*() {
      return yield* T.let("actual", { a: 1 })
    }),
  },
  nestedRawObject: {
    program: T.build(function*() {
      return yield* T.const("actual", T.prop(T.prop({ inner: { a: 1 } }, "inner"), "a"))
    }),
  },
  stableObjectField: {
    program: T.build(function*() {
      const field = yield* T.const("field", "a", T.Literal("a"))
      return yield* T.const("actual", T.prop({ field }, "field"))
    }),
  },
  contextualObjectReturn: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        returns: T.Object({ ok: T.Literal(true) }),
        body: function*() {
          return { ok: true }
        },
      })
    }),
  },
  contextualObjectBinding: {
    program: T.build(function*() {
      return yield* T.const("actual", { ok: true }, T.Object({ ok: T.Literal(true) }))
    }),
  },
  rawProperty: {
    program: T.build(function*() {
      return yield* T.const("actual", T.prop(rawObject, "a"))
    }),
  },
  loneReturn: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        body: function*() {
          return "A"
        },
      })
    }),
  },
  nodeReturns: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("b", T.Boolean)],
        body: function*({ b }) {
          yield* T.if(b, function*() {
            yield* T.return("A")
          })
          return T.stringLiteral("B")
        },
      })
    }),
  },
  plainReturns: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("b", T.Boolean)],
        body: function*({ b }) {
          yield* T.if(b, function*() {
            yield* T.return("A")
          })
          return "B"
        },
      })
    }),
  },
  arrowReturns: {
    program: T.build(function*() {
      return yield* T.const(
        "actual",
        T.arrow({
          params: [T.param("b", T.Boolean)],
          body: function*({ b }) {
            yield* T.if(b, function*() {
              yield* T.return("A")
            })
            return "B"
          },
        }),
      )
    }),
  },
  nestedFunction: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        body: function*() {
          yield* T.fn("inner", {
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
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("b", T.Boolean)],
        body: function*({ b }) {
          yield* T.if(b, function*() {
            yield* T.return({ a: 1 })
          })
          return { b: 2 }
        },
      })
    }),
  },
  threeObjectReturns: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("a", T.Boolean), T.param("b", T.Boolean)],
        body: function*({ a, b }) {
          yield* T.if(a, function*() {
            yield* T.return({ a: 1 })
          })
          yield* T.if(b, function*() {
            yield* T.return({ b: "b" })
          })
          return { c: true }
        },
      })
    }),
  },
  conditionalObjectReturn: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("b", T.Boolean)],
        body: function*({ b }) {
          return T.cond(b, { a: 1 }, { b: 2 })
        },
      })
    }),
  },
  objectRefReturns: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        params: [T.param("b", T.Boolean), T.param("a", T.Object({ a: T.Number })), T.param("c", T.Object({ c: T.Number }))],
        body: function*({ b, a, c }) {
          yield* T.if(b, function*() {
            yield* T.return(a)
          })
          return c
        },
      })
    }),
  },
  contextualBinding: {
    program: T.build(function*() {
      return yield* T.const(
        "actual",
        T.arrow({
          body: function*() {
            return "A"
          },
        }),
        T.Function([], T.String),
      )
    }),
  },
  mixedArray: {
    program: T.build(function*() {
      return yield* T.const("actual", ["a", 1])
    }),
  },
  stableArray: {
    program: T.build(function*() {
      const c = yield* T.const("c", "a", T.Literal("a"))
      return yield* T.const("actual", [c])
    }),
  },
  emptyReturn: {
    program: T.build(function*() {
      return yield* T.fn("actual", {
        body: function*() {
          return emptyArray
        },
      })
    }),
  },
  emptyField: {
    program: T.build(function*() {
      return yield* T.const("actual", { values: emptyArray })
    }),
  },
  emptyInitializer: {
    program: T.build(function*() {
      return yield* T.const("actual", [], T.Array(T.String))
    }),
  },
  arithmetic: {
    program: T.build(function*() {
      return yield* T.const("actual", T.mod(T.div(T.mul(T.sub(T.add(1, 2), 3), 4), 5), 6))
    }),
  },
  concatenation: {
    program: T.build(function*() {
      return yield* T.const("actual", T.add("x", 1))
    }),
  },
  bigintArithmetic: {
    ambient: "declare const a: bigint; declare const b: bigint;",
    program: T.build(function*() {
      return yield* T.const("actual", T.add(T.hostValue<bigint>("a"), T.hostValue<bigint>("b")))
    }),
  },
  symbolAddition: {
    ambient: "declare const symbolValue: symbol;",
    diagnostics: [2469],
    program: T.build(function*() {
      // @ts-expect-error stage 1 now rejects this, and the native diagnostic remains a control
      return yield* T.const("actual", T.add("x", T.hostValue<symbol>("symbolValue")))
    }),
  },
  incomparableEquality: {
    diagnostics: [2367],
    program: T.build(function*() {
      // @ts-expect-error stage 1 now rejects this, and the native diagnostic remains a control
      return yield* T.const("actual", T.eq(1, "x"))
    }),
  },
  constLogical: {
    program: T.build(function*() {
      return yield* T.const("actual", T.and(false, "b"))
    }),
  },
  letLogical: {
    program: T.build(function*() {
      return yield* T.let("actual", T.and(false, "b"))
    }),
  },
  stableFalsyLogical: {
    program: T.build(function*() {
      const left = yield* T.const("left", false, T.Literal(false))
      return yield* T.let("actual", T.and(left, "unreachable"))
    }),
  },
  freshTruthyLogical: {
    program: T.build(function*() {
      const left = yield* T.const("left", true)
      return yield* T.let("actual", T.and(left, "b"))
    }),
  },
  stableTruthyLogical: {
    program: T.build(function*() {
      const left = yield* T.const("left", true, T.Literal(true))
      const right = yield* T.const("right", "b", T.Literal("b"))
      return yield* T.let("actual", T.and(left, right))
    }),
  },
  freshOrLogical: {
    program: T.build(function*() {
      const left = yield* T.const("left", false)
      return yield* T.let("actual", T.or(left, "b"))
    }),
  },
  arrayIndex: {
    program: T.build(function*() {
      const xs = yield* T.const("xs", [1])
      return yield* T.const("actual", T.index(xs, 0))
    }),
  },
  tupleIndex: {
    ambient: "declare const tuple: [number, string];",
    program: T.build(function*() {
      return yield* T.const("actual", T.index(T.hostValue<[number, string]>("tuple"), 0))
    }),
  },
  dynamicTupleIndex: {
    ambient: "declare const tuple: [number, string]; declare const i: number;",
    program: T.build(function*() {
      return yield* T.const("actual", T.index(T.hostValue<[number, string]>("tuple"), T.hostValue<number>("i")))
    }),
  },
} satisfies Readonly<Record<string, ExactCase>>

const contextualRestriction = function*() {
  const literalArrow = T.arrow({
    body: function*() {
      return "A"
    },
  })
  // @ts-expect-error independently built arrows have no later contextual typing; the stricter rejection is intentional
  T.const("actual", literalArrow, T.Function([], T.Literal("A")))
  // @ts-expect-error unannotated evolving-array initializers are rejected rather than modeled
  const evolving = yield* T.const("actual", [])
  // @ts-expect-error stage 1 does not implement TypeScript's flow-sensitive evolving array writes
  T.assign(T.index(evolving, 0), 1)
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
