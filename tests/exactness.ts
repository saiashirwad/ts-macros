import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import type { Equal, ExactCase } from "./typing.ts"

export const rawObject = Expr.object({ a: 1 })
export const emptyArray = Expr.array()

type Tree = { value: number; children: Tree[] }
const tree: Tree = { value: 1, children: [] }

export const cases = {
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
