import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import type { ExactCase } from "./typing.ts"

type Id = string & { readonly __brand: "Id" }
type Tree = { value: number; children: Tree[] }

export const cases = {
  branded: {
    ambient: "type Id = string & { readonly __brand: \"Id\" }; declare const id: Id;",
    program: Program.build(function*() {
      return yield* Decl.const("savedId", FFI.Value<Id>("id"))
    }),
  },
  recursive: {
    ambient: "type Tree = { value: number; children: Tree[] }; declare const tree: Tree;",
    program: Program.build(function*() {
      return yield* Decl.const("savedTree", FFI.Value<Tree>("tree"))
    }),
  },
  literal: {
    program: Program.build(function*() {
      return yield* Decl.const("fresh", "draft")
    }),
  },
  union: {
    program: Program.build(function*() {
      const status = yield* Decl.let("status", "draft", Type.union(Type.literal("draft"), Type.literal("done")))
      yield* Stmt.assign(status, "done")
      return status
    }),
  },
  expression: {
    ambient: "declare function takeNumber(value: number): number;",
    program: Program.build(function*() {
      return yield* Decl.const("total", Expr.add(Expr.call(FFI.Value<(value: number) => number>("takeNumber"), 1), 2))
    }),
  },
  objectFields: {
    program: Program.build(function*() {
      return yield* Decl.const("row", Expr.object({ label: "draft", count: 1 }))
    }),
  },
  generic: {
    program: Program.build(function*() {
      const T = Type.param("T")
      const identity = Expr.arrow({
        typeParams: [T],
        params: [Expr.param("value", T)],
        returns: T,
        // eslint-disable-next-line require-yield -- DSL function bodies are generators even when they only return a value.
        body: function*({ value }) {
          return value
        },
      })
      return yield* Decl.const("same", Expr.call(Expr.instantiate(identity, Type.number), 7))
    }),
  },
} satisfies Record<string, ExactCase>
