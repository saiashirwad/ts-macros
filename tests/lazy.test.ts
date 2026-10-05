import assert from "node:assert/strict"
import { test } from "node:test"
import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"

import { emitProgram } from "../targets/ts.ts"

const fn = Decl.fn

test("a yielded function declaration keeps its impl factory and has no body until Program.build", () => {
  let ran = false
  const builder = fn("f", {
    params: [Expr.param("x", Type.number)],
    body: function*({ x }) {
      ran = true
      return x
    },
  })
  const iterator = builder[Symbol.iterator]()
  const { value, done } = iterator.next()
  assert.equal(done, false)
  const declaration = value as Decl.FunctionDeclaration & { readonly impl?: unknown; readonly body?: unknown }
  assert.equal("impl" in declaration, true)
  assert.equal(declaration.body, undefined)
  assert.equal(ran, false)

  const program = Program.build(function*() {
    yield* builder
    return null
  })
  const built = program.statements[0] as Decl.FunctionDeclaration & { readonly impl?: unknown; readonly body?: unknown }
  assert.equal(built.impl, undefined)
  assert.equal((built.body as { readonly kind: string }).kind, "block")
  assert.equal(ran, true)
})

test("arrows stay eager: the body is materialized at construction", () => {
  const arrow = Expr.arrow({
    params: [Expr.param("x", Type.number)],
    body: function*({ x }) {
      return x
    },
  })
  assert.equal((arrow as { readonly impl?: unknown }).impl, undefined)
  assert.equal((arrow.body as { readonly kind: string }).kind, "block")
})

test("self-recursion: fibonacci calls itself through the captured ref", () => {
  const program = Program.build(function*() {
    const fib: Expr.FnRef<[Expr.Param<"n", number>], number, []> = yield* fn("fib", {
      params: [Expr.param("n", Type.number)],
      returns: Type.number,
      body: function*({ n }) {
        yield* Stmt.if(Expr.binary("<", n, Expr.number(2)), function*() {
          yield* Stmt.return(n)
        })
        return Expr.binary(
          "+",
          Expr.call(fib, Expr.binary("-", n, Expr.number(1))),
          Expr.call(fib, Expr.binary("-", n, Expr.number(2))),
        )
      },
    })
    return fib
  })

  const code = emitProgram(program)
  assert.match(code, /function fib\(n: number\): number/)
  assert.match(code, /fib\(n - 1\) \+ fib\(n - 2\)/)

  const declaration = program.statements[0] as Decl.BuiltFunction
  const body = declaration.body!
  const returned = body.statements[body.statements.length - 1] as unknown as {
    readonly kind: string
    readonly value: { readonly kind: string; readonly left: { readonly callee: { readonly kind: string; readonly nameHint: string } } }
  }
  assert.equal(returned.kind, "return")
  assert.equal(returned.value.kind, "binary")
  assert.equal(returned.value.left.callee.kind, "ref")
  assert.equal(returned.value.left.callee.nameHint, "fib")
})

test("mutual recursion: even and odd resolve forward edges through captured refs", () => {
  const program = Program.build(function*() {
    const even: Expr.FnRef<[Expr.Param<"n", number>], boolean, []> = yield* fn("even", {
      params: [Expr.param("n", Type.number)],
      returns: Type.boolean,
      body: function*({ n }) {
        yield* Stmt.if(Expr.binary("===", n, Expr.number(0)), function*() {
          yield* Stmt.return(Expr.boolean(true))
        })
        return Expr.call(odd, Expr.binary("-", n, Expr.number(1)))
      },
    })

    const odd: Expr.FnRef<[Expr.Param<"n", number>], boolean, []> = yield* fn("odd", {
      params: [Expr.param("n", Type.number)],
      returns: Type.boolean,
      body: function*({ n }) {
        yield* Stmt.if(Expr.binary("===", n, Expr.number(0)), function*() {
          yield* Stmt.return(Expr.boolean(false))
        })
        return Expr.call(even, Expr.binary("-", n, Expr.number(1)))
      },
    })

    return even
  })

  const evenDecl = program.statements[0] as Decl.BuiltFunction
  const evenCall = evenDecl.body!.statements[evenDecl.body!.statements.length - 1] as unknown as {
    readonly kind: string
    readonly value: { readonly callee: { readonly nameHint: string } }
  }
  assert.equal(evenCall.value.callee.nameHint, "odd")

  const oddDecl = program.statements[1] as Decl.BuiltFunction
  const oddCall = oddDecl.body!.statements[oddDecl.body!.statements.length - 1] as unknown as {
    readonly kind: string
    readonly value: { readonly callee: { readonly nameHint: string } }
  }
  assert.equal(oddCall.value.callee.nameHint, "even")

  const code = emitProgram(program)
  assert.match(code, /function even\(n: number\): boolean/)
  assert.match(code, /return odd\(n - 1\)/)
  assert.match(code, /function odd\(n: number\): boolean/)
  assert.match(code, /return even\(n - 1\)/)
})
