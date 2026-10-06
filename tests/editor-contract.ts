import * as T from "../src/index.ts"

type Id = string & { readonly __brand: "Id" }
type Tree = { value: number; children: Tree[] }

export const editorProgram = T.build(function*() {
  const savedId = yield* T.const("savedId", T.hostValue<Id>("id"))
  const savedTree = yield* T.const("savedTree", T.hostValue<Tree>("tree"))
  const fresh = yield* T.const("fresh", "draft")
  const status = yield* T.let("status", "draft", T.Union(T.Literal("draft"), T.Literal("done")))
  yield* T.assign(status, "done")
  const row = yield* T.const("row", T.objectLiteral({ label: "draft", count: 1 }))
  const takeTree = T.hostValue<(value: Tree) => number>("takeTree")
  const result = yield* T.const("result", T.add(T.call(takeTree, savedTree), 1))
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
  const same = yield* T.const("same", T.call(T.instantiate(identity, T.Number), 7))
  return { savedId, savedTree, fresh, status, row, result, same }
})

export type RowValue = T.Denotes<typeof editorProgram.result.row>
export const rowValue: RowValue = { label: "draft", count: 1 }
export const treeValue: T.Denotes<typeof editorProgram.result.savedTree> = { value: 1, children: [] }
export const stateValue: T.Denotes<typeof editorProgram.result.status> = "done"
