import * as T from "../src/index.ts"
import type { ExactCase } from "./typing.ts"

type Id = string & { readonly __brand: "Id" }
type Tree = { value: number; children: Tree[] }

export const cases = {
  branded: {
    ambient: "type Id = string & { readonly __brand: \"Id\" }; declare const id: Id;",
    program: T.build(function*() {
      return yield* T.const("savedId", T.hostValue<Id>("id"))
    }),
  },
  recursive: {
    ambient: "type Tree = { value: number; children: Tree[] }; declare const tree: Tree;",
    program: T.build(function*() {
      return yield* T.const("savedTree", T.hostValue<Tree>("tree"))
    }),
  },
  literal: {
    program: T.build(function*() {
      return yield* T.const("fresh", "draft")
    }),
  },
  union: {
    program: T.build(function*() {
      const status = yield* T.let("status", "draft", T.Union(T.Literal("draft"), T.Literal("done")))
      yield* T.assign(status, "done")
      return status
    }),
  },
  expression: {
    ambient: "declare function takeNumber(value: number): number;",
    program: T.build(function*() {
      return yield* T.const("total", T.add(T.call(T.hostValue<(value: number) => number>("takeNumber"), 1), 2))
    }),
  },
  objectFields: {
    program: T.build(function*() {
      return yield* T.const("row", T.objectLiteral({ label: "draft", count: 1 }))
    }),
  },
  generic: {
    program: T.build(function*() {
      const TParam = T.TypeParam("T")
      const identity = T.arrow({
        typeParams: [TParam],
        params: [T.param("value", TParam)],
        returns: TParam,
        // eslint-disable-next-line require-yield -- DSL function bodies are generators even when they only return a value.
        body: function*({ value }) {
          return value
        },
      })
      return yield* T.const("same", T.call(T.instantiate(identity, T.Number), 7))
    }),
  },
} satisfies Record<string, ExactCase>
