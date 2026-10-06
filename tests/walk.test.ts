import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { walk } from "../src/walk.ts"

const fn = $.fn

test("walk: visits all real IR nodes in a nested AST", () => {
  const program = $.build(function*() {
    const x = yield* $.const("x", $.number(42))
    const f = yield* fn("calc", {
      params: [$.param("n", $.Number)],
      body: function*({ n }) {
        yield* $.if($.binary("<", n, $.number(0)), function*() {
          yield* $.return($.number(0))
        })
        return $.binary("+", n, x)
      },
    })
    return $.call(f, $.number(10))
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
  const node = $.arrow({
    params: [$.param("n", $.Number)],
    body: function*() {
      return $.binary("-", $.binary("*", 3, 2), 1)
    },
  })

  const visited: string[] = []
  walk(node, (child) => {
    visited.push(child.kind === "literal" ? `literal ${child.value}` : child.kind)
  })

  assert.deepEqual(visited, ["arrow", "param", "block", "return", "binary", "binary", "literal 3", "literal 2", "literal 1"])
})

test("walk: enables clean import collection across AST depths", () => {
  const lodash = $.hostImport<{ chunk: (...args: any[]) => any }>("lodash", "_")
  const path = $.hostImport<any>("node:path", "path")
  const program = $.build(function*() {
    const arr = yield* $.const("arr", $.array($.number(1), $.number(2)))
    yield* $.do($.call($.prop(lodash, "chunk"), arr, $.number(1)))
    yield* $.do($.call($.prop(path, "join"), $.string("a"), $.string("b")))
    return $.number(0)
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
