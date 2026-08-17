import assert from "node:assert/strict"
import test from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { walk } from "../src/walk.ts"

test("walk: visits all real IR nodes in a nested AST", () => {
  const program = Program.build(function*() {
    const x = yield* Binding.Const("x").pipe(Binding.Init(Expr.Number(42)))
    const f = yield* Fn.Function("calc").pipe(
      Fn.Params(Fn.Param("n", Type.Number())),
      Fn.Impl(function*({ n }) {
        yield* Stmt.If(Expr.Binary("<", n, Expr.Number(0)), function*() {
          yield* Stmt.Return(Expr.Number(0))
        })
        return Expr.Binary("+", n, x)
      }),
    )
    return Fn.Call(f, Expr.Number(10))
  })

  const visitedTags: string[] = []
  walk(program, (node) => {
    visitedTags.push(node.tag)
  })

  assert.ok(visitedTags.includes("const-declaration"))
  assert.ok(visitedTags.includes("function-declaration"))
  assert.ok(visitedTags.includes("param"))
  assert.ok(visitedTags.includes("if"))
  assert.ok(visitedTags.includes("binary"))
  assert.ok(visitedTags.includes("literal"))
  assert.ok(visitedTags.includes("call-expr"))
})

test("walk: ignores unbranded userland objects with tag fields", () => {
  // A literal object created in userland containing a 'tag' key
  const fakeNode = {
    tag: "fake-unbranded-tag",
    nested: { tag: "another-fake-tag" },
  }

  const realNode = Expr.Object({
    userObject: Expr.String("hello"),
  })

  const visited: string[] = []
  walk({ fake: fakeNode, ast: realNode }, (node) => {
    visited.push(node.tag)
  })

  assert.deepEqual(visited, ["object", "literal"])
  assert.ok(!visited.includes("fake-unbranded-tag"))
  assert.ok(!visited.includes("another-fake-tag"))
})

test("walk: guards against cycles and self-referential structures without overflowing", () => {
  const circularObj: any = {
    tag: "unbranded-circular",
    ast: Expr.Number(123),
  }
  circularObj.self = circularObj

  const visited: string[] = []
  assert.doesNotThrow(() => {
    walk(circularObj, (node) => {
      visited.push(node.tag)
    })
  })

  assert.deepEqual(visited, ["literal"])
})

test("walk: enables clean import collection across AST depths", () => {
  const lodash = FFI.Import<{ chunk: (...args: any[]) => any }>("lodash", "_")
  const path = FFI.Import<any>("node:path", "path")
  const program = Program.build(function*() {
    const arr = yield* Binding.Const("arr").pipe(Binding.Init(Expr.Array(Expr.Number(1), Expr.Number(2))))
    yield* Stmt.Do(Fn.Call(Expr.Prop(lodash, "chunk"), arr, Expr.Number(1)))
    yield* Stmt.Do(Fn.Call(Expr.Prop(path, "join"), Expr.String("a"), Expr.String("b")))
    return Expr.Number(0)
  })

  const imports: Array<{ name: string; source: string }> = []
  walk(program, (node) => {
    if (node.tag === "external-ref") {
      const ref = node as unknown as Expr.ExternalRef<any>
      if (ref.source !== undefined) {
        imports.push({ name: ref.name, source: ref.source })
      }
    }
  })

  assert.deepEqual(imports, [
    { name: "_", source: "lodash" },
    { name: "path", source: "node:path" },
  ])
})
