import assert from "node:assert/strict"
import { test } from "node:test"

import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { walk } from "../src/walk.ts"

const fn = Decl.fn

test("walk: visits all real IR nodes in a nested AST", () => {
  const program = Program.build(function*() {
    const x = yield* Decl.const("x", Expr.number(42))
    const f = yield* fn("calc", {
      params: [Expr.param("n", Type.number)],
      body: function*({ n }) {
        yield* Stmt.if(Expr.binary("<", n, Expr.number(0)), function*() {
          yield* Stmt.return(Expr.number(0))
        })
        return Expr.binary("+", n, x)
      },
    })
    return Expr.call(f, Expr.number(10))
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
  const node = Expr.arrow({
    params: [Expr.param("n", Type.number)],
    body: function*() {
      return Expr.binary("-", Expr.binary("*", 3, 2), 1)
    },
  })

  const visited: string[] = []
  walk(node, (child) => {
    visited.push(child.kind === "literal" ? `literal ${child.value}` : child.kind)
  })

  assert.deepEqual(visited, ["arrow", "param", "block", "return", "binary", "binary", "literal 3", "literal 2", "literal 1"])
})

test("walk: enables clean import collection across AST depths", () => {
  const lodash = FFI.Import<{ chunk: (...args: any[]) => any }>("lodash", "_")
  const path = FFI.Import<any>("node:path", "path")
  const program = Program.build(function*() {
    const arr = yield* Decl.const("arr", Expr.array(Expr.number(1), Expr.number(2)))
    yield* Stmt.do(Expr.call(Expr.prop(lodash, "chunk"), arr, Expr.number(1)))
    yield* Stmt.do(Expr.call(Expr.prop(path, "join"), Expr.string("a"), Expr.string("b")))
    return Expr.number(0)
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
