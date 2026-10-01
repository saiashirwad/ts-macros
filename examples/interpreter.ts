import { Decl, Expr, Program, Stmt, Type } from "../src/index.ts"
import { emitProgram } from "../targets/typescript/index.ts"

type Term =
  | readonly ["num", number]
  | readonly ["var", string]
  | readonly ["+" | "*", Term, Term]
  | readonly ["let", string, Term, Term]
  | readonly ["min", Term, Term]

type Env = ReadonlyMap<string, Expr.Expr<number>>

function* share(name: string, value: Expr.Expr<number>) {
  return value.kind === "ref" || value.kind === "literal" ? value : yield* Decl.const_(name, value)
}

function* compile(term: Term, env: Env): Stmt.Splice<Expr.Expr<number>> {
  switch (term[0]) {
    case "num":
      return Expr.number(term[1])
    case "var": {
      const bound = env.get(term[1])
      if (bound === undefined) throw new Error(`unbound variable ${term[1]}`)
      return bound
    }
    case "let": {
      const [, name, init, body] = term
      const value = yield* Decl.const_(name, yield* compile(init, env))
      return yield* compile(body, new Map(env).set(name, value))
    }
    case "min": {
      const a = yield* share("a", yield* compile(term[1], env))
      const b = yield* share("b", yield* compile(term[2], env))
      return Expr.cond(Expr.lt(a, b), a, b)
    }
    case "+":
      return Expr.add(yield* compile(term[1], env), yield* compile(term[2], env))
    case "*":
      return Expr.mul(yield* compile(term[1], env), yield* compile(term[2], env))
  }
}

const n: Term = ["var", "n"]
const x: Term = ["var", "x"]
const source: Term = ["let", "x", ["+", n, ["num", 1]], ["let", "x", ["*", x, x], ["min", x, ["*", n, ["num", 10]]]]]

export const program = Program.build(function*() {
  return yield* Decl.fn("best", {
    params: [Expr.param("values", Type.array(Type.number))],
    body: function*({ values }) {
      const top = yield* Decl.let_("top", 0)
      yield* Stmt.forOf("n", values, function*(n) {
        const score = yield* Decl.const_("score", yield* compile(source, new Map([["n", n]])))
        yield* Stmt.if_(Expr.gt(score, top), function*() {
          yield* Stmt.assign(top, score)
        })
      })
      return top
    },
  })
})

console.log(emitProgram(program))
