import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import type { Equal, ExactCase } from "./typing.ts"

export const rawObject = Expr.object({ a: 1 })
export const emptyArray = Expr.array()

export const cases = {
  rawObject: {
    expression: rawObject,
    mismatch: "raw object fields must widen at construction (#31 item 4)",
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
  rawProperty: {
    mismatch: "object fields must widen at construction (#31 item 4)",
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
    mismatch: "returned object unions need missing optional properties (#31 item 6)",
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
    mismatch: "unannotated empty initializers require evolving-array inference and will be rejected (#31)",
    program: Program.build(function*() {
      return yield* Decl.const_("actual", [])
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
    mismatch: "logical result must precede widening (#31 item 3)",
    program: Program.build(function*() {
      return yield* Decl.let_("actual", Expr.and(false, "b"))
    }),
  },
  arrayIndex: {
    mismatch: "array reads must include undefined (#31 item 5)",
    program: Program.build(function*() {
      const xs = yield* Decl.const_("xs", [1])
      return yield* Decl.const_("actual", Expr.index(xs, 0))
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
