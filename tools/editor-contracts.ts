export type HoverProbe = {
  id: string
  method: "hover"
  anchor: string
  offset: number
  require: string[]
  maxLength: number
}

export type SignatureProbe = {
  id: string
  method: "signatureHelp"
  anchor: string
  offset: number
  require: string[]
  activeParameter: number
}

export type CompletionProbe = {
  id: string
  method: "completion"
  anchor: string
  offset: number
  require: string[]
}

export type Probe = HoverProbe | SignatureProbe | CompletionProbe

export const editorFile = "tests/editor-contract.ts"

export const probes: Probe[] = [
  { id: "saved-id", method: "hover", anchor: "const savedId", offset: 9, require: ["Ref<Id, false, false, []>"], maxLength: 250 },
  { id: "saved-tree", method: "hover", anchor: "const savedTree", offset: 9, require: ["Ref<Tree, false, false, []>"], maxLength: 250 },
  {
    id: "fresh-literal",
    method: "hover",
    anchor: "const fresh",
    offset: 8,
    require: ["Ref<\"draft\", false, true, []>"],
    maxLength: 250,
  },
  {
    id: "union-state",
    method: "hover",
    anchor: "const status",
    offset: 8,
    require: ["\"draft\"", "\"done\"", "true, false, []>"],
    maxLength: 250,
  },
  {
    id: "object-binding",
    method: "hover",
    anchor: "const row =",
    offset: 8,
    require: ["label: $.LiteralExpr<\"draft\">", "count: $.LiteralExpr<1>"],
    maxLength: 400,
  },
  { id: "call-result", method: "hover", anchor: "const result", offset: 8, require: ["Ref<number, false, false, []>"], maxLength: 250 },
  { id: "generic-call", method: "hover", anchor: "const same", offset: 8, require: ["Ref<number, false, false, []>"], maxLength: 250 },
  {
    id: "object-denotation",
    method: "hover",
    anchor: "type RowValue",
    offset: 8,
    require: ["label: string", "count: number"],
    maxLength: 250,
  },
  { id: "recursive-denotation", method: "hover", anchor: "const treeValue", offset: 9, require: ["Tree"], maxLength: 250 },
  {
    id: "tree-call-signature",
    method: "signatureHelp",
    anchor: "$.call(takeTree, savedTree)",
    offset: 16,
    require: ["value: Tree", "number", "$.In<Tree>"],
    activeParameter: 1,
  },
  { id: "expression-members", method: "completion", anchor: "$.add(", offset: 2, require: ["add", "call", "instantiate"] },
  { id: "program-members", method: "completion", anchor: "editorProgram.result.row", offset: 14, require: ["result", "statements"] },
  { id: "contextual-object", method: "completion", anchor: "RowValue = { label: \"draft\"", offset: 13, require: ["label"] },
  { id: "contextual-state", method: "completion", anchor: "status> = \"done\"", offset: 11, require: ["draft", "done"] },
]
