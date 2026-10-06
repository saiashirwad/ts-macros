import * as $ from "../src/index.ts"
import type { ExactCase } from "./typing.ts"

type Id = string & { readonly __brand: "Id" }
type Tree = { value: number; children: Tree[] }

export const cases = {
  branded: {
    ambient: "type Id = string & { readonly __brand: \"Id\" }; declare const id: Id;",
    program: $.build(function*() {
      return yield* $.const("savedId", $.hostValue<Id>("id"))
    }),
  },
  recursive: {
    ambient: "type Tree = { value: number; children: Tree[] }; declare const tree: Tree;",
    program: $.build(function*() {
      return yield* $.const("savedTree", $.hostValue<Tree>("tree"))
    }),
  },
  literal: {
    program: $.build(function*() {
      return yield* $.const("fresh", "draft")
    }),
  },
  union: {
    program: $.build(function*() {
      const status = yield* $.let("status", "draft", $.Union($.Literal("draft"), $.Literal("done")))
      yield* $.assign(status, "done")
      return status
    }),
  },
  expression: {
    ambient: "declare function takeNumber(value: number): number;",
    program: $.build(function*() {
      return yield* $.const("total", $.add($.call($.hostValue<(value: number) => number>("takeNumber"), 1), 2))
    }),
  },
  objectFields: {
    program: $.build(function*() {
      return yield* $.const("row", $.object({ label: "draft", count: 1 }))
    }),
  },
  generic: {
    program: $.build(function*() {
      const T = $.TypeParam("T")
      const identity = $.arrow({
        typeParams: [T],
        params: [$.param("value", T)],
        returns: T,
        // eslint-disable-next-line require-yield -- DSL function bodies are generators even when they only return a value.
        body: function*({ value }) {
          return value
        },
      })
      return yield* $.const("same", $.call($.instantiate(identity, $.Number), 7))
    }),
  },
} satisfies Record<string, ExactCase>
