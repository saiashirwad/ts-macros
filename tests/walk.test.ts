import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { walk } from "../src/walk.ts"

const fn = T.fn

test("walk: visits all real IR nodes in a nested AST", () => {
  const program = T.build(function*() {
    const x = yield* T.const("x", T.numberLiteral(42))
    const f = yield* fn("calc", {
      params: [T.param("n", T.Number)],
      body: function*({ n }) {
        yield* T.if(T.binary("<", n, T.numberLiteral(0)), function*() {
          yield* T.return(T.numberLiteral(0))
        })
        return T.binary("+", n, x)
      },
    })
    return T.call(f, T.numberLiteral(10))
  })

  const visitedKinds: string[] = []
  walk([...program.statements, program.result], (node) => {
    visitedKinds.push(node.kind)
  })

  assert.ok(visitedKinds.includes("const-declaration"))
  assert.ok(visitedKinds.includes("function-declaration"))
  assert.ok(visitedKinds.includes("param"))
  assert.ok(visitedKinds.includes("if"))
  assert.ok(visitedKinds.includes("binary"))
  assert.ok(visitedKinds.includes("literal"))
  assert.ok(visitedKinds.includes("call"))
})

test("walk: visits children in source order and does not enter type annotations", () => {
  const node = T.arrow({
    params: [T.param("n", T.Number)],
    body: function*() {
      return T.binary("-", T.binary("*", 3, 2), 1)
    },
  })

  const visited: string[] = []
  walk(node, (child) => {
    visited.push(child.kind === "literal" ? `literal ${child.value}` : child.kind)
  })

  assert.deepEqual(visited, ["arrow", "param", "block", "return", "binary", "binary", "literal 3", "literal 2", "literal 1"])
})

test("walk: enables clean import collection across AST depths", () => {
  const lodash = T.hostImport<{ chunk: (...args: any[]) => any }>("lodash", "_")
  const path = T.hostImport<any>("node:path", "path")
  const program = T.build(function*() {
    const arr = yield* T.const("arr", T.arrayLiteral(T.numberLiteral(1), T.numberLiteral(2)))
    yield* T.do(T.call(T.prop(lodash, "chunk"), arr, T.numberLiteral(1)))
    yield* T.do(T.call(T.prop(path, "join"), T.stringLiteral("a"), T.stringLiteral("b")))
    return T.numberLiteral(0)
  })

  const imports: Array<{ name: string; source: string }> = []
  walk(program.statements, (node) => {
    if (node.kind === "external" && node.source !== undefined) {
      imports.push({ name: node.name, source: node.source })
    }
  })

  assert.deepEqual(imports, [
    { name: "_", source: "lodash" },
    { name: "path", source: "node:path" },
  ])
})
