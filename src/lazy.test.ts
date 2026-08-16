import assert from "node:assert/strict"
import test from "node:test"

import { emitProgram } from "../targets/typescript/index.ts"
import * as $ from "./$.ts"
import * as Binding from "./binding.ts"
import * as Expr from "./expr.ts"
import * as Fn from "./function.ts"
import * as Program from "./program.ts"
import * as Stmt from "./statement.ts"
import * as Type from "./types/index.ts"

test("a yielded function declaration keeps its impl factory and has no body until Program.build", () => {
  let ran = false
  const builder = Fn.Function("f").pipe(
    Fn.Params(Fn.Param("x", Type.Number())),
    Fn.Impl(function*({ x }) {
      ran = true
      return x
    }),
  )
  const iterator = builder[Symbol.iterator]()
  const { value, done } = iterator.next()
  assert.equal(done, false)
  const declaration = value as Fn.FunctionDeclaration & { readonly impl?: unknown; readonly body?: unknown }
  assert.equal("impl" in declaration, true)
  assert.equal(declaration.body, undefined)
  assert.equal(ran, false) // the factory only runs at build time

  const program = Program.build(function*() {
    yield* builder
    return null
  })
  const built = program.statements[0] as Fn.FunctionDeclaration & { readonly impl?: unknown; readonly body?: unknown }
  assert.equal(built.impl, undefined)
  assert.equal((built.body as { readonly tag: string }).tag, "block")
  assert.equal(ran, true)
})

test("arrows stay eager: the body is materialized at construction", () => {
  const arrow = Fn.Arrow([Fn.Param("x", Type.Number())], function*({ x }) {
    return x
  })
  assert.equal((arrow as { readonly impl?: unknown }).impl, undefined)
  assert.equal((arrow.body as { readonly tag: string }).tag, "block")
})

test("self-recursion: fibonacci calls itself through the captured ref", () => {
  const program = Program.build(function*() {
    const fib: Fn.FunctionRef<[Fn.Param<"n", number>], number> = yield* Fn.Function("fib").pipe(
      Fn.Params(Fn.Param("n", Type.Number())),
      Fn.Returns(Type.Number()),
      Fn.Impl(function*({ n }) {
        yield* Stmt.If(Expr.Binary("<", n, Expr.Number(2)), function*() {
          yield* Stmt.Return(n)
        })
        return Expr.Binary(
          "+",
          Fn.Call(fib, Expr.Binary("-", n, Expr.Number(1))),
          Fn.Call(fib, Expr.Binary("-", n, Expr.Number(2))),
        )
      }),
    )
    return fib
  })

  const code = emitProgram(program)
  assert.match(code, /function fib\(n: number\): number/)
  assert.match(code, /fib\(n - 1\) \+ fib\(n - 2\)/)

  const declaration = program.statements[0] as Fn.FunctionDeclaration
  const body = declaration.body!
  const returned = body.statements[body.statements.length - 1] as unknown as {
    readonly tag: string
    readonly value: { readonly tag: string; readonly left: { readonly callee: { readonly tag: string; readonly name: string } } }
  }
  assert.equal(returned.tag, "return")
  assert.equal(returned.value.tag, "binary")
  assert.equal(returned.value.left.callee.tag, "function-ref")
  assert.equal(returned.value.left.callee.name, "fib")
})

test("mutual recursion: even and odd resolve forward edges through captured refs", () => {
  const program = Program.build(function*() {
    const even: Fn.FunctionRef<[Fn.Param<"n", number>], boolean> = yield* Fn.Function("even").pipe(
      Fn.Params(Fn.Param("n", Type.Number())),
      Fn.Returns(Type.Boolean()),
      Fn.Impl(function*({ n }) {
        yield* Stmt.If(Expr.Binary("===", n, Expr.Number(0)), function*() {
          yield* Stmt.Return(Expr.Boolean(true))
        })
        return Fn.Call(odd, Expr.Binary("-", n, Expr.Number(1)))
      }),
    )

    const odd: Fn.FunctionRef<[Fn.Param<"n", number>], boolean> = yield* Fn.Function("odd").pipe(
      Fn.Params(Fn.Param("n", Type.Number())),
      Fn.Returns(Type.Boolean()),
      Fn.Impl(function*({ n }) {
        yield* Stmt.If(Expr.Binary("===", n, Expr.Number(0)), function*() {
          yield* Stmt.Return(Expr.Boolean(false))
        })
        return Fn.Call(even, Expr.Binary("-", n, Expr.Number(1)))
      }),
    )

    return even
  })

  const evenDecl = program.statements[0] as Fn.FunctionDeclaration
  const evenCall = evenDecl.body!.statements[evenDecl.body!.statements.length - 1] as unknown as {
    readonly tag: string
    readonly value: { readonly callee: { readonly name: string } }
  }
  assert.equal(evenCall.value.callee.name, "odd")

  const oddDecl = program.statements[1] as Fn.FunctionDeclaration
  const oddCall = oddDecl.body!.statements[oddDecl.body!.statements.length - 1] as unknown as {
    readonly tag: string
    readonly value: { readonly callee: { readonly name: string } }
  }
  assert.equal(oddCall.value.callee.name, "even")

  const code = emitProgram(program)
  assert.match(code, /function even\(n: number\): boolean/)
  assert.match(code, /return odd\(n - 1\)/)
  assert.match(code, /function odd\(n: number\): boolean/)
  assert.match(code, /return even\(n - 1\)/)
})
