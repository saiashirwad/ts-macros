import assert from "node:assert/strict"
import { test } from "node:test"

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as FFI from "../src/ffi.ts"
import * as Program from "../src/program.ts"
import * as Stmt from "../src/statement.ts"
import * as Type from "../src/types/index.ts"
import { walk } from "../src/walk.ts"

type FnReturn<Declared, Final, Yields> = unknown extends Declared ? Expr.Denotes<Expr.Lift<Final> | Stmt.ReturnValue<Yields>> : Declared

/** `Stmt.fn` intersects a rest-style `CheckLift` onto the spec, which blocks inference. */
const fn = Stmt.fn as <
  const Params extends Expr.AnyParams = [],
  Declared = unknown,
  const TypeParams extends Type.AnyParams = [],
  Yields extends Stmt.NonLoopStatement = never,
  Final = unknown,
>(
  name: string,
  spec:
    & Omit<Stmt.FnSpec<Params, Declared, TypeParams, Yields, Final>, "params">
    & {
      readonly params?: Params & (Expr.CheckParams<Params> extends infer C ? C extends unknown[] ? C : unknown : unknown)
    }
    & (unknown extends Declared ? unknown
      : [Expr.Denotes<Stmt.ReturnValue<Yields>>] extends [Declared] ? unknown : ["early returns do not satisfy the declared return type"])
    & (unknown extends Declared ? unknown : [Expr.Value<Final>] extends [Declared] ? unknown : ["the returned value is not assignable"]),
) => Stmt.FunctionBuilder<Params, FnReturn<Declared, Final, Yields>, TypeParams>

test("walk: visits all real IR nodes in a nested AST", () => {
  const program = Program.build(function*() {
    const x = yield* Binding.const_("x", Expr.number(42))
    const f = yield* fn("calc", {
      params: [Expr.param("n", Type.number)],
      body: function*({ n }) {
        yield* Stmt.if_(Expr.binary("<", n, Expr.number(0)), function*() {
          yield* Stmt.return_(Expr.number(0))
        })
        return Expr.binary("+", n, x)
      },
    })
    return Expr.call(f, Expr.number(10))
  })

  const visitedKinds: string[] = []
  walk(program, (node) => {
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

test("walk: ignores unbranded userland objects with kind fields", () => {
  // A literal object created in userland containing a 'kind' key
  const fakeNode = {
    kind: "fake-unbranded-tag",
    nested: { kind: "another-fake-tag" },
  }

  const realNode = Expr.object({
    userObject: Expr.string("hello"),
  })

  const visited: string[] = []
  walk({ fake: fakeNode, ast: realNode }, (node) => {
    visited.push(node.kind)
  })

  assert.deepEqual(visited, ["object", "literal"])
  assert.ok(!visited.includes("fake-unbranded-tag"))
  assert.ok(!visited.includes("another-fake-tag"))
})

test("walk: guards against cycles and self-referential structures without overflowing", () => {
  const circularObj: any = {
    kind: "unbranded-circular",
    ast: Expr.number(123),
  }
  circularObj.self = circularObj

  const visited: string[] = []
  assert.doesNotThrow(() => {
    walk(circularObj, (node) => {
      visited.push(node.kind)
    })
  })

  assert.deepEqual(visited, ["literal"])
})

test("walk: enables clean import collection across AST depths", () => {
  const lodash = FFI.Import<{ chunk: (...args: any[]) => any }>("lodash", "_")
  const path = FFI.Import<any>("node:path", "path")
  const program = Program.build(function*() {
    const arr = yield* Binding.const_("arr", Expr.array(Expr.number(1), Expr.number(2)))
    yield* Stmt.do_(Expr.call(Expr.prop(lodash, "chunk"), arr, Expr.number(1)))
    yield* Stmt.do_(Expr.call(Expr.prop(path, "join"), Expr.string("a"), Expr.string("b")))
    return Expr.number(0)
  })

  const imports: Array<{ name: string; source: string }> = []
  walk(program, (node) => {
    if (node.kind === "ref") {
      const ref = node as Expr.Ref<any>
      if (ref.id === undefined && ref.source !== undefined) {
        imports.push({ name: ref.name, source: ref.source })
      }
    }
  })

  assert.deepEqual(imports, [
    { name: "_", source: "lodash" },
    { name: "path", source: "node:path" },
  ])
})
