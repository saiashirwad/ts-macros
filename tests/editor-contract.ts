import * as $ from "../src/index.ts"

type Id = string & { readonly __brand: "Id" }
type Tree = { value: number; children: Tree[] }

export const editorProgram = $.build(function*() {
  const savedId = yield* $.const("savedId", $.hostValue<Id>("id"))
  const savedTree = yield* $.const("savedTree", $.hostValue<Tree>("tree"))
  const fresh = yield* $.const("fresh", "draft")
  const status = yield* $.let("status", "draft", $.Union($.Literal("draft"), $.Literal("done")))
  yield* $.assign(status, "done")
  const row = yield* $.const("row", $.object({ label: "draft", count: 1 }))
  const takeTree = $.hostValue<(value: Tree) => number>("takeTree")
  const result = yield* $.const("result", $.add($.call(takeTree, savedTree), 1))
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
  const same = yield* $.const("same", $.call($.instantiate(identity, $.Number), 7))
  return { savedId, savedTree, fresh, status, row, result, same }
})

export type RowValue = $.Denotes<typeof editorProgram.result.row>
export const rowValue: RowValue = { label: "draft", count: 1 }
export const treeValue: $.Denotes<typeof editorProgram.result.savedTree> = { value: 1, children: [] }
export const stateValue: $.Denotes<typeof editorProgram.result.status> = "done"
