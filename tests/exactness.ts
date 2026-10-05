import { Decl, Expr, FFI, Guard, Program, Stmt, Type } from "../src/index.ts"
import type { Equal, ExactCase } from "./typing.ts"

export const rawObject = Expr.object({ a: 1 })
export const emptyArray = Expr.array()

type Tree = { value: number; children: Tree[] }
const tree: Tree = { value: 1, children: [] }

const guarded = <A, Out>(type: Type.Type<A>, guard: (input: Expr.Ref<A, true>) => Guard.Guard<Out>, ambient: string = "") => {
  let expression: Expr.Ref<Out, false> | undefined
  const program = Program.build(function*() {
    const input = yield* Decl.let_("input", Expr.call(FFI.Value<() => never>("fail")), type)
    const fn = yield* Decl.fn("guarded", {
      body: function*() {
        yield* Stmt.ifGuard(guard(input), function*(narrowed) {
          expression = narrowed
          yield* Stmt.return_(narrowed)
        })
        return Expr.call(FFI.Value<() => never>("fail"))
      },
    })
    return yield* Decl.const_("actual", Expr.call(fn))
  })
  return { ambient: `declare function fail(): never; ${ambient}`, program, expression: expression! }
}

const isDate = FFI.Value<(value: unknown) => value is Date>("isDate")
const date = Type.external<Date>("Date")
const datePredicate = "declare function isDate(value: unknown): value is Date;"
const isRow = FFI.Value<(value: unknown) => value is { x: number }>("isRow")
const row = Type.object({ x: Type.number })
const rowPredicate = "declare function isRow(value: unknown): value is { x: number };"

const rejected = <A, Negative>(
  type: Type.Type<A>,
  guard: (input: Expr.Ref<A, true>) => Guard.Guard<any> & { readonly complement: Type.Type<Negative>; readonly complementCheck?: readonly [] },
  ambient: string = "",
  native: boolean = true,
) => {
  let expression: Expr.Ref<Negative, false> | undefined
  const program = Program.build(function*() {
    const input = yield* Decl.let_("input", Expr.call(FFI.Value<() => never>("fail")), type)
    const value = guard(input)
    const alias = yield* Decl.fn("alias", {
      body: function*() {
        const builder = Stmt.ifGuard(value, function*() {
          yield* Stmt.throw_(0)
        })
        yield* builder.elseGuard(
          function*(rest) {
            expression = rest
            yield* Stmt.return_(rest)
          },
          "rest",
        )
        return Expr.call(FFI.Value<() => never>("fail"))
      },
    })
    const nativeFalse = yield* Decl.fn("nativeFalse", {
      body: function*() {
        yield* Stmt.if_(value.condition, function*() {
          yield* Stmt.throw_(0)
        }).pipe(Stmt.else_(function*() {
          yield* Stmt.return_(input)
        }))
        return Expr.call(FFI.Value<() => never>("fail"))
      },
    })
    return native ? yield* Decl.const_("actual", Expr.call(nativeFalse)) : yield* Decl.const_("actual", Expr.call(alias))
  })
  return { ambient: `declare function fail(): never; ${ambient}`, program, expression: expression! }
}

const optionalRows = Type.union(Type.object({ a: Type.optional(Type.number) }), Type.object({ b: Type.string }))
const taggedRows = Type.union(
  Type.object({ kind: Type.literal("a") }),
  Type.object({ kind: Type.literal("b") }),
  Type.object({ kind: Type.literal("c") }),
)

export const cases = {
  elseUnknownTypeof: rejected(Type.unknown, (input) => Guard.typeof_(input, "string")),
  elseUnknownNumber: rejected(Type.unknown, (input) => Guard.typeof_(input, "number")),
  elseUnknownBoolean: rejected(Type.unknown, (input) => Guard.typeof_(input, "boolean")),
  elseUnknownBigint: rejected(Type.unknown, (input) => Guard.typeof_(input, "bigint")),
  elseUnknownSymbol: rejected(Type.unknown, (input) => Guard.typeof_(input, "symbol")),
  elseUnknownUndefined: rejected(Type.unknown, (input) => Guard.typeof_(input, "undefined")),
  elseUnknownObject: rejected(Type.unknown, (input) => Guard.typeof_(input, "object")),
  elseUnknownFunction: rejected(Type.unknown, (input) => Guard.typeof_(input, "function")),
  elseUnionString: rejected(Type.union(Type.literal("yes"), Type.number, Type.null_), (input) => Guard.typeof_(input, "string")),
  elseUnionNumber: rejected(Type.union(Type.string, Type.number), (input) => Guard.typeof_(input, "number")),
  elseUnionBoolean: rejected(Type.union(Type.string, Type.boolean), (input) => Guard.typeof_(input, "boolean")),
  elseUnionBigint: rejected(Type.union(Type.string, Type.bigint), (input) => Guard.typeof_(input, "bigint")),
  elseUnionSymbol: rejected(Type.union(Type.string, Type.symbol), (input) => Guard.typeof_(input, "symbol")),
  elseUnionUndefined: rejected(Type.union(Type.string, Type.undefined_), (input) => Guard.typeof_(input, "undefined")),
  elseUnionObject: rejected(Type.union(row, Type.null_, Type.string, Type.fn([], Type.number)), (input) => Guard.typeof_(input, "object")),
  elseUnionFunction: rejected(Type.union(row, Type.fn([], Type.number)), (input) => Guard.typeof_(input, "function")),
  elseBroadFunction: rejected(Type.object_, (input) => Guard.typeof_(input, "function")),
  elseRecordFunction: rejected(row, (input) => Guard.typeof_(input, "function")),
  elseNeverFunction: rejected(Type.fn([], Type.number), (input) => Guard.typeof_(input, "function")),
  elseUnknownNullish: rejected(Type.unknown, (input) => Guard.notNullish(input)),
  elseUnionNullish: rejected(Type.union(Type.string, Type.null_, Type.undefined_), (input) => Guard.notNullish(input)),
  elseVoidNullish: rejected(Type.void_, (input) => Guard.notNullish(input)),
  elseNeverNullish: rejected(row, (input) => Guard.notNullish(input)),
  elseUnknownArray: rejected(Type.unknown, (input) => Guard.isArray(input)),
  elseUnionArray: rejected(Type.union(Type.array(Type.number), Type.string, Type.null_), (input) => Guard.isArray(input)),
  elseReadonlyArray: rejected(Type.readonlyArray(Type.number), (input) => Guard.isArray(input)),
  elseMixedArray: rejected(Type.union(Type.readonlyArray(Type.number), Type.array(Type.string), Type.null_), (input) => Guard.isArray(input)),
  elseTupleArray: rejected(Type.union(Type.tuple(Type.number), Type.string), (input) => Guard.isArray(input)),
  elseEq: rejected(taggedRows, (input) => Guard.eq(input, "kind", "a")),
  elseIn: rejected(Type.union(row, Type.object({ y: Type.string })), (input) => Guard.in_(input, "x")),
  elseOptionalIn: rejected(optionalRows, (input) => Guard.in_(input, "a")),
  elseUnlistedIn: rejected(optionalRows, (input) => Guard.in_(input, "missing")),
  elseObjectIn: rejected(Type.object_, (input) => Guard.in_(input, "missing")),
  elseOwn: rejected(optionalRows, (input) => Guard.hasOwn(input, "a")),
  elseOwnArray: rejected(Type.array(Type.number), (input) => Guard.hasOwn(input, "0")),
  elseUnknownInstance: rejected(Type.unknown, (input) => Guard.instanceOf(input, FFI.Value<typeof Date>("Date"), date)),
  elseObjectInstance: rejected(Type.object_, (input) => Guard.instanceOf(input, FFI.Value<typeof Date>("Date"), date)),
  elseNullableInstance: rejected(
    Type.union(date, Type.null_, Type.undefined_),
    (input) => Guard.instanceOf(input, FFI.Value<typeof Date>("Date"), date),
  ),
  elseUnknownPredicate: rejected(Type.unknown, (input) => Guard.predicate(isRow, input, row), rowPredicate),
  elseExactInstance: rejected(date, (input) => Guard.instanceOf(input, FFI.Value<typeof Date>("Date"), date)),
  elseAbstractInstance: rejected(
    Type.unknown,
    (input) => Guard.instanceOf(input, FFI.Value<abstract new() => Date>("Ctor"), date),
    "declare const Ctor: abstract new () => Date;",
  ),
  elseObjectPredicate: rejected(Type.object_, (input) => Guard.predicate(isRow, input, row), rowPredicate),
  elseUnionPredicate: rejected(Type.union(row, Type.string, Type.null_), (input) => Guard.predicate(isRow, input, row), rowPredicate),
  elseFilteredPredicate: rejected(Type.union(row, Type.object({ y: Type.string })), (input) => Guard.predicate(isRow, input, row), rowPredicate),
  elseExactPredicate: rejected(row, (input) => Guard.predicate(isRow, input, row), rowPredicate),
  elseUnknownUnionPredicate: rejected(
    Type.unknown,
    (input) => Guard.predicate(FFI.Value<(value: unknown) => value is string | number>("isScalar"), input, Type.union(Type.string, Type.number)),
    "declare function isScalar(value: unknown): value is string | number;",
  ),
  elseAndUnknown: rejected(Type.unknown, (input) => Guard.and(Guard.typeof_(input, "object"), Guard.notNullish(input))),
  elseAndUnion: rejected(
    Type.union(Type.object_, Type.null_, Type.string),
    (input) => Guard.and(Guard.typeof_(input, "object"), Guard.notNullish(input)),
  ),
  elseAndReverse: rejected(
    Type.union(Type.object_, Type.null_, Type.string),
    (input) => Guard.and(Guard.notNullish(input), Guard.typeof_(input, "object")),
  ),
  elseAndIn: rejected(optionalRows, (input) => Guard.and(Guard.in_(input, "a"), Guard.hasOwn(input, "a"))),
  elseAndInTypeof: rejected(Type.object_, (input) => Guard.and(Guard.in_(input, "value"), Guard.typeof_(input, "object"))),
  elseAndEq: rejected(taggedRows, (input) => Guard.and(Guard.typeof_(input, "object"), Guard.eq(input, "kind", "a"))),
  elseAndArray: rejected(
    Type.union(Type.readonlyArray(Type.number), Type.array(Type.string), Type.null_),
    (input) => Guard.and(Guard.isArray(input), Guard.notNullish(input)),
  ),
  elseAndNested: rejected(
    Type.unknown,
    (input) => Guard.and(Guard.typeof_(input, "object"), Guard.and(Guard.notNullish(input), Guard.notNullish(input))),
  ),
  elseAliasNullish: rejected(Type.unknown, (input) => Guard.notNullish(input), "", false),
  elseAndInstance: rejected(
    Type.unknown,
    (input) => Guard.and(Guard.instanceOf(input, FFI.Value<typeof Date>("Date"), date), Guard.notNullish(input)),
  ),
  elseAndPredicate: rejected(Type.unknown, (input) => Guard.and(Guard.predicate(isRow, input, row), Guard.notNullish(input)), rowPredicate),
  elseAndReadonlyOwn: rejected(Type.readonlyArray(Type.number), (input) => Guard.and(Guard.isArray(input), Guard.hasOwn(input, "0"))),
  elseAliasMixedArray: rejected(
    Type.union(Type.readonlyArray(Type.number), Type.array(Type.string), Type.null_),
    (input) => Guard.isArray(input),
    "",
    false,
  ),
  elseAliasEq: rejected(taggedRows, (input) => Guard.eq(input, "kind", "a"), "", false),
  elseAliasAnd: rejected(
    Type.union(Type.object_, Type.null_, Type.string),
    (input) => Guard.and(Guard.typeof_(input, "object"), Guard.notNullish(input)),
    "",
    false,
  ),
  elseAliasDeclarationNarrowing: {
    program: Program.build(function*() {
      const fn = yield* Decl.fn("read", {
        body: function*() {
          const input = yield* Decl.const_("input", Expr.null_(), Type.union(Type.string, Type.number, Type.null_))
          yield* Stmt.ifGuard(Guard.typeof_(input, "string"), function*() {
            yield* Stmt.throw_(0)
          }).elseGuard(function*(rest) {
            yield* Stmt.return_(rest)
          })
          return Expr.call(FFI.Value<() => never>("fail"))
        },
      })
      return yield* Decl.const_("actual", Expr.call(fn))
    }),
    ambient: "declare function fail(): never;",
  },
  readonlyArrayAnnotation: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.array(1, 2), Type.readonlyArray(Type.number))
    }),
  },
  readonlyArrayLiteralContext: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.array(Expr.object({ ok: true })), Type.readonlyArray(Type.object({ ok: Type.literal(true) })))
    }),
  },
  readonlyNestedArray: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", [[1]], Type.array(Type.readonlyArray(Type.number)))
    }),
  },
  readonlyArrayIndex: {
    program: Program.build(function*() {
      const items = yield* Decl.const_("items", [1], Type.readonlyArray(Type.number))
      return yield* Decl.const_("actual", Expr.index(items, 0))
    }),
  },
  readonlyArrayForOf: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("items", Type.readonlyArray(Type.literal("yes")))],
        body: function*({ items }) {
          yield* Stmt.forOf("item", items, function*(item) {
            yield* Stmt.return_(item)
          })
          return Expr.call(FFI.Value<() => never>("fail"))
        },
      })
    }),
    ambient: "declare function fail(): never;",
  },
  readonlyArrayWrite: {
    diagnostics: [2542],
    program: Program.build(function*() {
      const items = yield* Decl.const_("items", [1], Type.readonlyArray(Type.number))
      // @ts-expect-error readonly arrays reject index writes
      yield* Stmt.assign(Expr.index(items, 0), 2)
      return yield* Decl.const_("actual", items)
    }),
  },
  readonlyArrayLengthWrite: {
    diagnostics: [2540],
    program: Program.build(function*() {
      const items = yield* Decl.const_("items", [1], Type.readonlyArray(Type.number))
      // @ts-expect-error readonly array length is readonly too
      yield* Stmt.assign(Expr.prop(items, "length"), 2)
      return yield* Decl.const_("actual", items)
    }),
  },
  readonlyArraySubstitution: {
    program: Program.build(function*() {
      const list = yield* Decl.type_("List", { params: [Type.param("T")], body: ({ T }) => Type.readonlyArray(T) })
      return yield* Decl.const_("actual", [1], Type.apply(list, [Type.number]))
    }),
  },
  readonlyUnionIndex: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("items", Type.union(Type.readonlyArray(Type.number), Type.array(Type.string)))],
        body: function*({ items }) {
          return Expr.index(items, 0)
        },
      })
    }),
  },
  readonlyUnionForOf: {
    ambient: "declare function fail(): never;",
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("items", Type.union(Type.readonlyArray(Type.number), Type.array(Type.string)))],
        body: function*({ items }) {
          yield* Stmt.forOf("item", items, function*(item) {
            yield* Stmt.return_(item)
          })
          return Expr.call(FFI.Value<() => never>("fail"))
        },
      })
    }),
  },
  readonlyUnionWrite: {
    diagnostics: [2322],
    program: Program.build(function*() {
      const items = yield* Decl.let_(
        "items",
        Expr.call(FFI.Value<() => never>("fail")),
        Type.union(Type.readonlyArray(Type.number), Type.array(Type.number)),
      )
      // @ts-expect-error a possibly-readonly receiver cannot be written
      yield* Stmt.assign(Expr.index(items, 0), 1)
      return yield* Decl.const_("actual", 0)
    }),
    ambient: "declare function fail(): never;",
  },
  guardReadonlyArray: guarded(Type.readonlyArray(Type.number), (input) => Guard.isArray(input)),
  guardReadonlyUnionArray: guarded(Type.union(Type.readonlyArray(Type.number), Type.string), (input) => Guard.isArray(input)),
  guardMixedReadonlyArray: guarded(
    Type.union(Type.readonlyArray(Type.number), Type.array(Type.string), Type.null_),
    (input) => Guard.isArray(input),
  ),
  guardAndMixedReadonlyArray: guarded(
    Type.union(Type.readonlyArray(Type.number), Type.array(Type.string), Type.null_),
    (input) => Guard.and(Guard.isArray(input), Guard.notNullish(input)),
  ),
  guardUnknownFunction: guarded(Type.unknown, (input) => Guard.typeof_(input, "function")),
  guardObjectFunction: guarded(Type.object_, (input) => Guard.typeof_(input, "function")),
  guardRecordFunction: guarded(row, (input) => Guard.typeof_(input, "function")),
  guardUnionFunction: guarded(Type.union(Type.fn([Type.number], Type.string), Type.string, row), (input) => Guard.typeof_(input, "function")),
  guardBroadUnionFunction: guarded(Type.union(Type.object_, Type.fn([], Type.number)), (input) => Guard.typeof_(input, "function")),
  guardFunctionTypeUnion: guarded(
    Type.union(Type.external<Guard.Typeof<unknown, "function">>("Function"), Type.fn([], Type.number)),
    (input) => Guard.typeof_(input, "function"),
  ),
  guardFunctionObject: guarded(Type.fn([], Type.number), (input) => Guard.typeof_(input, "object")),
  guardFunctionUnionObject: guarded(Type.union(Type.fn([], Type.number), row, Type.null_), (input) => Guard.typeof_(input, "object")),
  guardAndFunction: guarded(Type.unknown, (input) => Guard.and(Guard.typeof_(input, "function"), Guard.notNullish(input))),
  guardUnknownInstance: guarded(Type.unknown, (input) => Guard.instanceOf(input, FFI.Value<typeof Date>("Date"), date)),
  guardObjectInstance: guarded(Type.object_, (input) => Guard.instanceOf(input, FFI.Value<typeof Date>("Date"), date)),
  guardNullableInstance: guarded(
    Type.union(date, Type.null_, Type.undefined_),
    (input) => Guard.instanceOf(input, FFI.Value<typeof Date>("Date"), date),
  ),
  guardAbstractInstance: guarded(
    Type.unknown,
    (input) => Guard.instanceOf(input, FFI.Value<abstract new(...args: any[]) => Date>("Ctor"), date),
    "declare const Ctor: abstract new (...args: any[]) => Date;",
  ),
  guardUnknownPredicate: guarded(Type.unknown, (input) => Guard.predicate(isDate, input, date), datePredicate),
  guardUnknownUnionPredicate: guarded(
    Type.unknown,
    (input) => Guard.predicate(FFI.Value<(value: unknown) => value is string | number>("isScalar"), input, Type.union(Type.string, Type.number)),
    "declare function isScalar(value: unknown): value is string | number;",
  ),
  guardObjectPredicate: guarded(Type.object_, (input) => Guard.predicate(isDate, input, date), datePredicate),
  guardUnionPredicate: guarded(Type.union(date, Type.string, Type.null_), (input) => Guard.predicate(isDate, input, date), datePredicate),
  guardSubtypePredicate: guarded(
    Type.union(Type.object({ x: Type.number, extra: Type.boolean }), Type.string),
    (input) => Guard.predicate(isRow, input, row),
    rowPredicate,
  ),
  guardIntersectionPredicate: guarded(Type.object({ y: Type.string }), (input) => Guard.predicate(isRow, input, row), rowPredicate),
  guardDisjointPredicate: guarded(
    Type.string,
    (input) => Guard.predicate(FFI.Value<(value: unknown) => value is number>("isNumber"), input, Type.number),
    "declare function isNumber(value: unknown): value is number;",
  ),
  guardFilteredPredicate: guarded(Type.union(row, Type.object({ y: Type.string })), (input) => Guard.predicate(isRow, input, row), rowPredicate),
  guardAndPredicate: guarded(Type.unknown, (input) => Guard.and(Guard.predicate(isDate, input, date), Guard.notNullish(input)), datePredicate),
  guardPredicateExpression: guarded(
    Type.unknown,
    (input) => Guard.predicate(Expr.prop(FFI.Value<{ isDate: (value: unknown) => value is Date }>("checks"), "isDate"), input, date),
    "declare const checks: { isDate(value: unknown): value is Date };",
  ),
  instanceofPrecedence: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("input", Type.unknown)],
        body: function*({ input }) {
          return Expr.not(Expr.binary("instanceof", input, FFI.Value<typeof Date>("Date")))
        },
      })
    }),
  },
  nullLiteral: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.null_())
    }),
  },
  guardUnknownString: guarded(Type.unknown, (input) => Guard.typeof_(input, "string")),
  guardUnknownNumber: guarded(Type.unknown, (input) => Guard.typeof_(input, "number")),
  guardUnknownBoolean: guarded(Type.unknown, (input) => Guard.typeof_(input, "boolean")),
  guardUnknownBigint: guarded(Type.unknown, (input) => Guard.typeof_(input, "bigint")),
  guardUnknownSymbol: guarded(Type.unknown, (input) => Guard.typeof_(input, "symbol")),
  guardUnknownUndefined: guarded(Type.unknown, (input) => Guard.typeof_(input, "undefined")),
  guardUnknownObject: guarded(Type.unknown, (input) => Guard.typeof_(input, "object")),
  guardUnknownNotNullish: guarded(Type.unknown, (input) => Guard.notNullish(input)),
  guardUnknownArray: guarded(Type.unknown, (input) => Guard.isArray(input)),
  guardUnionString: guarded(Type.union(Type.literal("yes"), Type.number), (input) => Guard.typeof_(input, "string")),
  guardUnionNumber: guarded(Type.union(Type.string, Type.literal(42)), (input) => Guard.typeof_(input, "number")),
  guardUnionBoolean: guarded(Type.union(Type.string, Type.boolean), (input) => Guard.typeof_(input, "boolean")),
  guardUnionBigint: guarded(Type.union(Type.string, Type.bigint), (input) => Guard.typeof_(input, "bigint")),
  guardUnionSymbol: guarded(Type.union(Type.string, Type.symbol), (input) => Guard.typeof_(input, "symbol")),
  guardUnionUndefined: guarded(Type.union(Type.string, Type.undefined_), (input) => Guard.typeof_(input, "undefined")),
  guardUnionObject: guarded(Type.union(Type.string, Type.object({ x: Type.number }), Type.null_), (input) => Guard.typeof_(input, "object")),
  guardUnionNotNullish: guarded(Type.union(Type.string, Type.null_, Type.undefined_), (input) => Guard.notNullish(input)),
  guardUnionArray: guarded(Type.union(Type.array(Type.number), Type.string, Type.null_), (input) => Guard.isArray(input)),
  guardTupleUnionArray: guarded(
    Type.union(Type.tuple(Type.number, Type.string), Type.array(Type.boolean), Type.number),
    (input) => Guard.isArray(input),
  ),
  guardUnknownUnionString: guarded(Type.union(Type.unknown, Type.number), (input) => Guard.typeof_(input, "string")),
  guardUnknownUnionObject: guarded(Type.union(Type.unknown, Type.object({ x: Type.number })), (input) => Guard.typeof_(input, "object")),
  guardUnknownUnionNotNullish: guarded(Type.union(Type.unknown, Type.number), (input) => Guard.notNullish(input)),
  guardObjectUnionString: guarded(Type.union(Type.string, Type.object({ x: Type.number })), (input) => Guard.typeof_(input, "string")),
  guardArrayUnionString: guarded(Type.union(Type.string, Type.array(Type.number)), (input) => Guard.typeof_(input, "string")),
  guardBroadObject: guarded(Type.object_, (input) => Guard.typeof_(input, "object")),
  guardBroadObjectString: guarded(Type.object_, (input) => Guard.typeof_(input, "string")),
  guardVoidNotNullish: guarded(Type.void_, (input) => Guard.notNullish(input)),
  guardAndUnknownObject: guarded(Type.unknown, (input) => Guard.and(Guard.typeof_(input, "object"), Guard.notNullish(input))),
  guardAndReverseObject: guarded(
    Type.union(Type.object_, Type.null_, Type.string),
    (input) => Guard.and(Guard.notNullish(input), Guard.typeof_(input, "object")),
  ),
  guardAndString: guarded(
    Type.union(Type.literal("yes"), Type.number, Type.null_),
    (input) => Guard.and(Guard.typeof_(input, "string"), Guard.notNullish(input)),
  ),
  guardAndArray: guarded(Type.unknown, (input) => Guard.and(Guard.isArray(input), Guard.notNullish(input))),
  guardAndNested: guarded(
    Type.unknown,
    (input) => Guard.and(Guard.typeof_(input, "object"), Guard.and(Guard.notNullish(input), Guard.notNullish(input))),
  ),
  guardHasOwnObject: guarded(Type.object_, (input) => Guard.hasOwn(input, "value")),
  guardHasOwnKnown: guarded(Type.object({ value: Type.optional(Type.number) }), (input) => Guard.hasOwn(input, "value")),
  guardHasOwnArray: guarded(Type.array(Type.number), (input) => Guard.hasOwn(input, "0")),
  guardInObject: guarded(Type.object_, (input) => Guard.in_(input, "value")),
  guardInUnlisted: guarded(Type.object({ x: Type.number }), (input) => Guard.in_(input, "value")),
  guardInUnion: guarded(Type.union(Type.object({ a: Type.number }), Type.object({ b: Type.string })), (input) => Guard.in_(input, "a")),
  guardInOptional: guarded(
    Type.union(Type.object({ a: Type.optional(Type.number) }), Type.object({ b: Type.string })),
    (input) => Guard.in_(input, "a"),
  ),
  guardInUnlistedUnion: guarded(Type.union(Type.object({ a: Type.number }), Type.object({ b: Type.string })), (input) => Guard.in_(input, "value")),
  guardOwnAndIn: guarded(Type.object_, (input) => Guard.and(Guard.hasOwn(input, "value"), Guard.in_(input, "value"))),
  guardInAndOwn: guarded(Type.object_, (input) => Guard.and(Guard.in_(input, "value"), Guard.hasOwn(input, "value"))),
  guardInAndIn: guarded(Type.object_, (input) => Guard.and(Guard.in_(input, "first"), Guard.in_(input, "second"))),
  guardInAndKnownUnion: guarded(
    Type.union(Type.object({ a: Type.number }), Type.object({ b: Type.string })),
    (input) => Guard.and(Guard.in_(input, "value"), Guard.in_(input, "a")),
  ),
  guardInAndTypeof: guarded(Type.object_, (input) => Guard.and(Guard.in_(input, "value"), Guard.typeof_(input, "object"))),
  guardDiscriminant: guarded(
    Type.union(
      Type.object({ kind: Type.literal("text"), value: Type.string }),
      Type.object({ kind: Type.literal("number"), value: Type.number }),
      Type.object({ kind: Type.literal("empty") }),
    ),
    (input) => Guard.eq(input, "kind", "text"),
  ),
  guardDiscriminantBoolean: guarded(
    Type.union(Type.object({ ok: Type.literal(true) }), Type.object({ ok: Type.literal(false) })),
    (input) => Guard.eq(input, "ok", true),
  ),
  guardAndDiscriminant: guarded(
    Type.union(Type.object({ kind: Type.literal("a") }), Type.object({ kind: Type.literal("b") })),
    (input) => Guard.and(Guard.typeof_(input, "object"), Guard.eq(input, "kind", "a")),
  ),
  guardAndSameDiscriminant: guarded(
    Type.union(Type.object({ kind: Type.literal("a") }), Type.object({ kind: Type.literal("b") })),
    (input) => Guard.and(Guard.eq(input, "kind", "a"), Guard.eq(input, "kind", "a")),
  ),
  guardInAndDiscriminant: guarded(
    Type.union(Type.object({ kind: Type.literal("a") }), Type.object({ kind: Type.literal("b") })),
    (input) => Guard.and(Guard.in_(input, "value"), Guard.eq(input, "kind", "a")),
  ),
  guardCheckedProperty: {
    program: Program.build(function*() {
      const fn = yield* Decl.fn("guarded", {
        params: [Expr.param("input", Type.object_)],
        body: function*({ input }) {
          const present = yield* Stmt.guard(Guard.in_(input, "value"), function*() {
            yield* Stmt.throw_("missing value")
          })
          return yield* Stmt.guard(Guard.typeof_(Expr.prop(present, "value"), "string"), function*() {
            yield* Stmt.throw_("not a string")
          })
        },
      })
      return yield* Decl.const_("actual", Expr.call(fn, Expr.object({ value: "yes" })))
    }),
  },
  guardClauseAlias: {
    program: Program.build(function*() {
      const fn = yield* Decl.fn("guarded", {
        params: [Expr.param("input", Type.unknown)],
        body: function*({ input }) {
          const value = yield* Stmt.guard(Guard.and(Guard.typeof_(input, "object"), Guard.notNullish(input)), function*() {
            yield* Stmt.return_(false)
          }, "value")
          return value
        },
      })
      return yield* Decl.const_("actual", Expr.call(fn, Expr.object({})))
    }),
  },
  guardClauseThrow: {
    program: Program.build(function*() {
      const fn = yield* Decl.fn("guarded", {
        params: [Expr.param("input", Type.unknown)],
        body: function*({ input }) {
          return yield* Stmt.guard(Guard.typeof_(input, "string"), function*() {
            yield* Stmt.throw_("not a string")
          })
        },
      })
      return yield* Decl.const_("actual", Expr.call(fn, Expr.string("yes")))
    }),
  },
  objectPrimitiveLogical: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("input", Type.object_)],
        body: function*({ input }) {
          return Expr.and(input, "yes")
        },
      })
    }),
  },
  assignLiteralObject: {
    ambient: "declare const obj: { x: { ok: true } };",
    program: Program.build(function*() {
      yield* Stmt.assign(Expr.prop(FFI.Value<{ x: { ok: true } }>("obj"), "x"), { ok: true })
      return yield* Decl.const_("actual", 1)
    }),
  },
  callLiteralObject: {
    ambient: "declare function consume(v: { ok: true }): number;",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.call(FFI.Value<(v: { ok: true }) => number>("consume"), Expr.object({ ok: true })))
    }),
  },
  callLiteralArray: {
    ambient: "declare function consume(v: { ok: true }[]): number;",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.call(FFI.Value<(v: { ok: true }[]) => number>("consume"), Expr.array(Expr.object({ ok: true }))))
    }),
  },
  callConditionalObject: {
    ambient: "declare const condition: boolean; declare function consume(v: { ok: true }): number;",
    program: Program.build(function*() {
      const choice = Expr.cond(FFI.Value<boolean>("condition"), Expr.object({ ok: true }), Expr.object({ ok: true }))
      return yield* Decl.const_("actual", Expr.call(FFI.Value<(v: { ok: true }) => number>("consume"), choice))
    }),
  },
  mappedAliasCapture: {
    program: Program.build(function*() {
      yield* Decl.const_("A", 0)
      const a = yield* Decl.type_("A", Type.number)
      const m = yield* Decl.type_("M", Type.mapped("A_2", Type.object({ a: Type.string }), a))
      return yield* Decl.const_("actual", { a: 1 }, m)
    }),
  },
  inferGenericAliasCapture: {
    program: Program.build(function*() {
      yield* Decl.const_("A", 0)
      const a = yield* Decl.type_("A", {
        params: [Type.param("T")],
        body: ({ T }) => Type.array(T),
      })
      yield* Decl.type_("M", Type.conditional(Type.string, Type.infer_("A_2"), Type.apply(a, [Type.number]), Type.never))
      return yield* Decl.const_("actual", 1)
    }),
  },
  failedArrowNumericRecord: {
    diagnostics: [2322],
    program: Program.build(function*() {
      const bad = Expr.arrow({
        returns: Type.string,
        body: function*() {
          return 1
        },
      })
      // @ts-expect-error the failure brand cannot be erased into a numeric record
      const candidate: Record<string, number> = bad ?? {}
      return yield* Decl.const_("actual", candidate)
    }),
  },
  failedArrowNeverRecord: {
    diagnostics: [2322],
    program: Program.build(function*() {
      const bad = Expr.arrow({
        returns: Type.string,
        body: function*() {
          return 1
        },
      })
      // @ts-expect-error the failure brand cannot be erased into a never record
      const candidate: Record<string, never> = bad ?? {}
      return yield* Decl.const_("actual", candidate)
    }),
  },
  explicitEmptyObject: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.object({}))
    }),
  },
  explicitNestedEmptyObject: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", { nested: Expr.object({}), values: [Expr.object({})] })
    }),
  },
  failedArrowNullishFallback: {
    diagnostics: [2322],
    program: Program.build(function*() {
      const bad = Expr.arrow({
        returns: Type.string,
        body: function*() {
          return 1
        },
      })
      const candidate = bad ?? {}
      // @ts-expect-error the erased object type cannot conceal an invalid arrow
      return yield* Decl.const_("actual", candidate)
    }),
  },
  failedArrowConditionalFallback: {
    diagnostics: [2322],
    program: Program.build(function*() {
      const bad = Expr.arrow({
        returns: Type.string,
        body: function*() {
          return 1
        },
      })
      const candidate = (Math.random() < 2 ? bad : {}) ?? {}
      // @ts-expect-error conditional common-type inference cannot conceal an invalid arrow
      return yield* Decl.const_("actual", candidate)
    }),
  },
  failedArrowArrayCommonType: {
    ambient: "declare function consume(...values: {}[]): void;",
    diagnostics: [2322],
    program: Program.build(function*() {
      const bad = Expr.arrow({
        returns: Type.string,
        body: function*() {
          return 1
        },
      })
      const args = [bad, {}].filter((value) => value !== undefined)
      // @ts-expect-error array common-type inference cannot conceal an invalid arrow
      const call = Expr.call(FFI.Value<(...values: {}[]) => void>("consume"), ...args)
      return yield* Decl.const_("actual", call)
    }),
  },
  unionReceiverPropertyWrite: {
    ambient: "declare const obj: { a: number; b: string } | { a: string; b: number };",
    program: Program.build(function*() {
      const key: "a" | "b" = Math.random() < 2 ? "a" : "b"
      yield* Stmt.assign(Expr.prop(FFI.Value<{ a: number; b: string } | { a: string; b: number }>("obj"), key), 1)
      return yield* Decl.const_("actual", 1)
    }),
  },
  unionReceiverOtherPropertyWrite: {
    ambient: "declare const obj: { a: number; b: string } | { a: string; b: number };",
    program: Program.build(function*() {
      const key: "a" | "b" = Math.random() < 0 ? "a" : "b"
      yield* Stmt.assign(Expr.prop(FFI.Value<{ a: number; b: string } | { a: string; b: number }>("obj"), key), "x")
      return yield* Decl.const_("actual", 1)
    }),
  },
  optionalTupleWrite: {
    ambient: "declare const tuple: [number?];",
    diagnostics: [2322],
    program: Program.build(function*() {
      // @ts-expect-error implicit undefined is not writable under exactOptionalPropertyTypes
      yield* Stmt.assign(Expr.index(FFI.Value<[number?]>("tuple"), 0), FFI.Value<undefined>("undefined"))
      return yield* Decl.const_("actual", 1)
    }),
  },
  optionalTupleNumberWrite: {
    ambient: "declare const tuple: [number?];",
    program: Program.build(function*() {
      yield* Stmt.assign(Expr.index(FFI.Value<[number?]>("tuple"), 0), 1)
      return yield* Decl.const_("actual", 1)
    }),
  },
  optionalTupleExplicitUndefinedWrite: {
    ambient: "declare const tuple: [(number | undefined)?];",
    program: Program.build(function*() {
      yield* Stmt.assign(Expr.index(FFI.Value<[(number | undefined)?]>("tuple"), 0), FFI.Value<undefined>("undefined"))
      return yield* Decl.const_("actual", 1)
    }),
  },
  absentLiteralReturnAnnotation: {
    program: Program.build(function*() {
      const returns = Math.random() < 2 ? undefined : Type.literal("A")
      return yield* Decl.fn("actual", {
        returns,
        body: function*() {
          return "A"
        },
      })
    }),
  },
  absentObjectReturnAnnotation: {
    program: Program.build(function*() {
      const returns = Math.random() < 2 ? undefined : Type.object({ ok: Type.literal(true) })
      const fn = yield* Decl.fn("fn", {
        returns,
        body: function*() {
          return { ok: true }
        },
      })
      return yield* Decl.const_("actual", Expr.call(fn), Type.object({ ok: Type.boolean }))
    }),
  },
  optionalBroadReturnAnnotation: {
    program: Program.build(function*() {
      const returns = Math.random() < 2 ? undefined : Type.number
      return yield* Decl.fn("actual", {
        returns,
        body: function*() {
          return 1
        },
      })
    }),
  },
  recursiveRecord: {
    ambient: "type Tree = { value: number; children: Tree[] }; declare function count(tree: Tree): number;",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.call(FFI.Value<(tree: Tree) => number>("count"), tree))
    }),
  },
  optionalNormalizedWrite: {
    diagnostics: [2412],
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("b", Type.boolean)],
        body: function*({ b }) {
          const x = yield* Decl.const_("x", Expr.cond(b, { a: 1 }, { b: 2 }))
          // @ts-expect-error optional reads include undefined, but writes do not
          yield* Stmt.assign(Expr.prop(x, "a"), FFI.Value<undefined>("undefined"))
          return x
        },
      })
    }),
  },
  tupleUnionWrite: {
    diagnostics: [2322],
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("tuple", Type.tuple(Type.number, Type.string)), Expr.param("i", Type.union(Type.literal(0), Type.literal(1)))],
        body: function*({ tuple, i }) {
          // @ts-expect-error a finite-union tuple write must satisfy every selected position
          yield* Stmt.assign(Expr.index(tuple, i), 1)
          return tuple
        },
      })
    }),
  },
  symbolLogical: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("x", Type.symbol)],
        body: function*({ x }) {
          return Expr.and(x, "yes")
        },
      })
    }),
  },
  symbolLogicalOr: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("x", Type.symbol)],
        body: function*({ x }) {
          return Expr.or(x, "unreachable")
        },
      })
    }),
  },
  stableLogicalCopy: {
    program: Program.build(function*() {
      const left = yield* Decl.const_("left", false, Type.literal(false))
      const selected = yield* Decl.const_("selected", Expr.and(left, "unreachable"))
      return yield* Decl.let_("actual", selected)
    }),
  },
  stableTruthyLogicalCopy: {
    program: Program.build(function*() {
      const left = yield* Decl.const_("left", "selected", Type.literal("selected"))
      const selected = yield* Decl.const_("selected", Expr.or(left, "unreachable"))
      return yield* Decl.let_("actual", selected)
    }),
  },
  selectedLogicalCopy: {
    program: Program.build(function*() {
      const left = yield* Decl.const_("left", false, Type.literal(false))
      const selected = yield* Decl.const_("selected", Expr.or(left, "reachable"))
      return yield* Decl.let_("actual", selected)
    }),
  },
  tupleBoundIndex: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("tuple", Type.tuple(Type.number, Type.string))],
        body: function*({ tuple }) {
          const i = yield* Decl.const_("i", 0)
          return Expr.index(tuple, i)
        },
      })
    }),
  },
  tupleAnnotatedIndex: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("tuple", Type.tuple(Type.number, Type.string)), Expr.param("i", Type.literal(1))],
        body: function*({ tuple, i }) {
          return Expr.index(tuple, i)
        },
      })
    }),
  },
  tupleUnionIndex: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("tuple", Type.tuple(Type.number, Type.string)), Expr.param("i", Type.union(Type.literal(0), Type.literal(1)))],
        body: function*({ tuple, i }) {
          return Expr.index(tuple, i)
        },
      })
    }),
  },
  objectConditionalBinding: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("b", Type.boolean)],
        body: function*({ b }) {
          return yield* Decl.const_("x", Expr.cond(b, { a: 1 }, { b: 2 }))
        },
      })
    }),
  },
  objectConditionalLet: {
    ambient: "declare const condition: boolean;",
    program: Program.build(function*() {
      return yield* Decl.let_("actual", Expr.cond(FFI.Value<boolean>("condition"), { a: 1 }, { b: 2 }))
    }),
  },
  objectConditionalField: {
    ambient: "declare const condition: boolean;",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", { choice: Expr.cond(FFI.Value<boolean>("condition"), { a: 1 }, { b: 2 }) })
    }),
  },
  objectArrayUnion: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", [{ a: 1 }, { b: 2 }])
    }),
  },
  mixedObjectConditional: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("b", Type.boolean), Expr.param("a", Type.object({ a: Type.number }))],
        body: function*({ b, a }) {
          return yield* Decl.const_("x", Expr.cond(b, a, { b: 2 }))
        },
      })
    }),
  },
  mixedObjectReturns: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("b", Type.boolean), Expr.param("a", Type.object({ a: Type.number }))],
        body: function*({ b, a }) {
          yield* Stmt.if_(b, function*() {
            yield* Stmt.return_(a)
          })
          return { b: 2 }
        },
      })
    }),
  },
  mixedThreeObjectReturns: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("b", Type.boolean), Expr.param("c", Type.boolean), Expr.param("a", Type.object({ a: Type.number }))],
        body: function*({ b, c, a }) {
          yield* Stmt.if_(b, function*() {
            yield* Stmt.return_(a)
          })
          yield* Stmt.if_(c, function*() {
            yield* Stmt.return_({ b: 2 })
          })
          return { c: 3 }
        },
      })
    }),
  },
  annotatedUnknownArrow: {
    program: Program.build(function*() {
      return yield* Decl.const_(
        "actual",
        Expr.arrow({
          returns: Type.unknown,
          body: function*() {
            return "A"
          },
        }),
      )
    }),
  },
  annotatedUnknownFunction: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        returns: Type.unknown,
        body: function*() {
          return "A"
        },
      })
    }),
  },
  annotatedAnyArrow: {
    program: Program.build(function*() {
      return yield* Decl.const_(
        "actual",
        Expr.arrow({
          returns: Type.any,
          body: function*() {
            return "A"
          },
        }),
      )
    }),
  },
  annotatedUndefinedFunction: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        returns: Type.undefined_,
        body: function*() {
          return FFI.Value<undefined>("undefined")
        },
      })
    }),
  },
  bigintLogical: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("x", Type.bigint)],
        body: function*({ x }) {
          return Expr.and(x, "yes")
        },
      })
    }),
  },
  bigintLogicalOr: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("x", Type.bigint)],
        body: function*({ x }) {
          return Expr.or(x, "yes")
        },
      })
    }),
  },
  zeroBigintLogical: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("x", Type.literal(0n))],
        body: function*({ x }) {
          return Expr.and(x, "yes")
        },
      })
    }),
  },
  badArrowArgument: {
    ambient: "declare function consume(x: (string | number)[]): void;",
    diagnostics: [2345, 2322],
    program: Program.build(function*() {
      const bad = Expr.arrow({
        returns: Type.string,
        body: function*() {
          return 1
        },
      })
      // @ts-expect-error failed arrow diagnostics cannot be used as call arguments
      return yield* Decl.const_("actual", Expr.call(FFI.Value<(x: (string | number)[]) => void>("consume"), bad))
    }),
  },
  rawObject: {
    expression: rawObject,
    program: Program.build(function*() {
      return yield* Decl.const_("actual", rawObject)
    }),
  },
  letLiteral: {
    program: Program.build(function*() {
      return yield* Decl.let_("actual", 1)
    }),
  },
  constLiteral: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", 1)
    }),
  },
  freshCopy: {
    program: Program.build(function*() {
      const c = yield* Decl.const_("c", "a")
      return yield* Decl.let_("actual", c)
    }),
  },
  stableCopy: {
    program: Program.build(function*() {
      const c = yield* Decl.const_("c", "a", Type.literal("a"))
      return yield* Decl.let_("actual", c)
    }),
  },
  constObject: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", { a: 1 })
    }),
  },
  letObject: {
    program: Program.build(function*() {
      return yield* Decl.let_("actual", { a: 1 })
    }),
  },
  nestedRawObject: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.prop(Expr.prop({ inner: { a: 1 } }, "inner"), "a"))
    }),
  },
  stableObjectField: {
    program: Program.build(function*() {
      const field = yield* Decl.const_("field", "a", Type.literal("a"))
      return yield* Decl.const_("actual", Expr.prop({ field }, "field"))
    }),
  },
  contextualObjectReturn: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        returns: Type.object({ ok: Type.literal(true) }),
        body: function*() {
          return { ok: true }
        },
      })
    }),
  },
  contextualObjectBinding: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", { ok: true }, Type.object({ ok: Type.literal(true) }))
    }),
  },
  rawProperty: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.prop(rawObject, "a"))
    }),
  },
  loneReturn: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        body: function*() {
          return "A"
        },
      })
    }),
  },
  nodeReturns: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("b", Type.boolean)],
        body: function*({ b }) {
          yield* Stmt.if_(b, function*() {
            yield* Stmt.return_("A")
          })
          return Expr.string("B")
        },
      })
    }),
  },
  plainReturns: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("b", Type.boolean)],
        body: function*({ b }) {
          yield* Stmt.if_(b, function*() {
            yield* Stmt.return_("A")
          })
          return "B"
        },
      })
    }),
  },
  arrowReturns: {
    program: Program.build(function*() {
      return yield* Decl.const_(
        "actual",
        Expr.arrow({
          params: [Expr.param("b", Type.boolean)],
          body: function*({ b }) {
            yield* Stmt.if_(b, function*() {
              yield* Stmt.return_("A")
            })
            return "B"
          },
        }),
      )
    }),
  },
  nestedFunction: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        body: function*() {
          yield* Decl.fn("inner", {
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
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("b", Type.boolean)],
        body: function*({ b }) {
          yield* Stmt.if_(b, function*() {
            yield* Stmt.return_({ a: 1 })
          })
          return { b: 2 }
        },
      })
    }),
  },
  threeObjectReturns: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("a", Type.boolean), Expr.param("b", Type.boolean)],
        body: function*({ a, b }) {
          yield* Stmt.if_(a, function*() {
            yield* Stmt.return_({ a: 1 })
          })
          yield* Stmt.if_(b, function*() {
            yield* Stmt.return_({ b: "b" })
          })
          return { c: true }
        },
      })
    }),
  },
  conditionalObjectReturn: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("b", Type.boolean)],
        body: function*({ b }) {
          return Expr.cond(b, { a: 1 }, { b: 2 })
        },
      })
    }),
  },
  objectRefReturns: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        params: [Expr.param("b", Type.boolean), Expr.param("a", Type.object({ a: Type.number })), Expr.param("c", Type.object({ c: Type.number }))],
        body: function*({ b, a, c }) {
          yield* Stmt.if_(b, function*() {
            yield* Stmt.return_(a)
          })
          return c
        },
      })
    }),
  },
  contextualBinding: {
    program: Program.build(function*() {
      return yield* Decl.const_(
        "actual",
        Expr.arrow({
          body: function*() {
            return "A"
          },
        }),
        Type.fn([], Type.string),
      )
    }),
  },
  mixedArray: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", ["a", 1])
    }),
  },
  stableArray: {
    program: Program.build(function*() {
      const c = yield* Decl.const_("c", "a", Type.literal("a"))
      return yield* Decl.const_("actual", [c])
    }),
  },
  emptyReturn: {
    program: Program.build(function*() {
      return yield* Decl.fn("actual", {
        body: function*() {
          return emptyArray
        },
      })
    }),
  },
  emptyField: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", { values: emptyArray })
    }),
  },
  emptyInitializer: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", [], Type.array(Type.string))
    }),
  },
  arithmetic: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.mod(Expr.div(Expr.mul(Expr.sub(Expr.add(1, 2), 3), 4), 5), 6))
    }),
  },
  concatenation: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.add("x", 1))
    }),
  },
  bigintArithmetic: {
    ambient: "declare const a: bigint; declare const b: bigint;",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.add(FFI.Value<bigint>("a"), FFI.Value<bigint>("b")))
    }),
  },
  symbolAddition: {
    ambient: "declare const symbolValue: symbol;",
    diagnostics: [2469],
    program: Program.build(function*() {
      // @ts-expect-error stage 1 now rejects this, and the native diagnostic remains a control
      return yield* Decl.const_("actual", Expr.add("x", FFI.Value<symbol>("symbolValue")))
    }),
  },
  incomparableEquality: {
    diagnostics: [2367],
    program: Program.build(function*() {
      // @ts-expect-error stage 1 now rejects this, and the native diagnostic remains a control
      return yield* Decl.const_("actual", Expr.eq(1, "x"))
    }),
  },
  constLogical: {
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.and(false, "b"))
    }),
  },
  letLogical: {
    program: Program.build(function*() {
      return yield* Decl.let_("actual", Expr.and(false, "b"))
    }),
  },
  stableFalsyLogical: {
    program: Program.build(function*() {
      const left = yield* Decl.const_("left", false, Type.literal(false))
      return yield* Decl.let_("actual", Expr.and(left, "unreachable"))
    }),
  },
  freshTruthyLogical: {
    program: Program.build(function*() {
      const left = yield* Decl.const_("left", true)
      return yield* Decl.let_("actual", Expr.and(left, "b"))
    }),
  },
  stableTruthyLogical: {
    program: Program.build(function*() {
      const left = yield* Decl.const_("left", true, Type.literal(true))
      const right = yield* Decl.const_("right", "b", Type.literal("b"))
      return yield* Decl.let_("actual", Expr.and(left, right))
    }),
  },
  freshOrLogical: {
    program: Program.build(function*() {
      const left = yield* Decl.const_("left", false)
      return yield* Decl.let_("actual", Expr.or(left, "b"))
    }),
  },
  arrayIndex: {
    program: Program.build(function*() {
      const xs = yield* Decl.const_("xs", [1])
      return yield* Decl.const_("actual", Expr.index(xs, 0))
    }),
  },
  tupleIndex: {
    ambient: "declare const tuple: [number, string];",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.index(FFI.Value<[number, string]>("tuple"), 0))
    }),
  },
  dynamicTupleIndex: {
    ambient: "declare const tuple: [number, string]; declare const i: number;",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", Expr.index(FFI.Value<[number, string]>("tuple"), FFI.Value<number>("i")))
    }),
  },
} satisfies Readonly<Record<string, ExactCase>>

const contextualRestriction = function*() {
  const literalArrow = Expr.arrow({
    body: function*() {
      return "A"
    },
  })
  // @ts-expect-error independently built arrows have no later contextual typing; the stricter rejection is intentional
  Decl.const_("actual", literalArrow, Type.fn([], Type.literal("A")))
  // @ts-expect-error unannotated evolving-array initializers are rejected rather than modeled
  const evolving = yield* Decl.const_("actual", [])
  // @ts-expect-error stage 1 does not implement TypeScript's flow-sensitive evolving array writes
  Stmt.assign(Expr.index(evolving, 0), 1)
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
