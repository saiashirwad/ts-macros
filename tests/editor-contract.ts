import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"

type Id = string & { readonly __brand: "Id" }
type Tree = { value: number; children: Tree[] }

export const editorProgram = Program.build(function*() {
  const savedId = yield* Decl.const_("savedId", FFI.Value<Id>("id"))
  const savedTree = yield* Decl.const_("savedTree", FFI.Value<Tree>("tree"))
  const fresh = yield* Decl.const_("fresh", "draft")
  const status = yield* Decl.let_("status", "draft", Type.union(Type.literal("draft"), Type.literal("done")))
  yield* Stmt.assign(status, "done")
  const row = yield* Decl.const_("row", Expr.object({ label: "draft", count: 1 }))
  const takeTree = FFI.Value<(value: Tree) => number>("takeTree")
  const result = yield* Decl.const_("result", Expr.add(Expr.call(takeTree, savedTree), 1))
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
  const same = yield* Decl.const_("same", Expr.call(Expr.instantiate(identity, Type.number), 7))
  return { savedId, savedTree, fresh, status, row, result, same }
})

export type RowValue = Expr.Denotes<typeof editorProgram.result.row>
export const rowValue: RowValue = { label: "draft", count: 1 }
export const treeValue: Expr.Denotes<typeof editorProgram.result.savedTree> = { value: 1, children: [] }
export const stateValue: Expr.Denotes<typeof editorProgram.result.status> = "done"
