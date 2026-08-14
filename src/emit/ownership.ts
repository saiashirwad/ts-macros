import type * as Expr from "../expr.ts"
import * as FFI from "../ffi.ts"
import * as Fn from "../function.ts"
import { Do, type Statement } from "../statement.ts"
import * as Type from "../types/index.ts"
import type { Synthesis } from "./synthesize.ts"
import { type Emit, makeEmit } from "./target.ts"
import { traversal } from "./traversal.ts"

declare const OwnedId: unique symbol

// the phantom marks a value whose storage the program is responsible for
// releasing; targets with manual memory decide what that means
export interface Owned<A> {
  readonly [OwnedId]?: A
}

export const owned = <A>(inner: Type.TypeExpr<A>): Type.TypeExpr<Owned<A>> => Type.Ref<Owned<A>>("Owned", inner)

export const isOwnedType = (type: Type.TypeExpr<any>): boolean => {
  const node = type as Type.Any
  return node.tag === "type-ref" && node.name === "Owned" && node.args !== undefined && node.args.length === 1
}

const freeStatement = (name: string): Statement => Do(Fn.Call(FFI.Value<(pointer: any) => void>("free"), FFI.Value(name)))

const usesName = (visit: (emit: Emit<void, void, void>) => void, name: string): boolean => {
  let found = false
  const emit = makeEmit({
    ...traversal,
    expr: {
      ...traversal.expr,
      "var-ref": (node) => {
        if (node.name === name) found = true
      },
    },
  })
  visit(emit)
  return found
}

const statementUses = (statement: Statement, name: string): boolean => usesName((emit) => emit.statement(statement), name)

const exprUses = (expr: Expr.Expr<any>, name: string): boolean => usesName((emit) => emit.expr(expr), name)

const isExactRef = (expr: Expr.Expr<any>, name: string): boolean => {
  const node = expr as unknown as { readonly tag: string; readonly name?: string }
  return node.tag === "var-ref" && node.name === name
}

interface LocalOwned {
  readonly name: string
  freed: boolean
}

// frees every Owned binding exactly once on every path: after its last use
// in the declaring block, before any return that does not move it, at block
// end if never used. `return x` moves ownership to the caller.
export const insertFrees = (statements: ReadonlyArray<Statement>, types: Synthesis): Statement[] => {
  const processBlock = (list: ReadonlyArray<Statement>, enclosing: readonly string[]): Statement[] => {
    const local: LocalOwned[] = []
    const liveLocal = () => local.filter((binding) => !binding.freed)
    const liveNames = () => [...enclosing, ...liveLocal().map((binding) => binding.name)]
    const out: Statement[] = []

    const rebuild = (statement: Statement): Statement => {
      const live = liveNames()
      switch (statement.tag) {
        case "if":
          return {
            ...statement,
            clauses: statement.clauses.map((clause) => ({
              condition: clause.condition,
              body: { tag: "block", statements: processBlock(clause.body.statements, live) },
            })),
            else: statement.else === null ? null : { tag: "block", statements: processBlock(statement.else.statements, live) },
          }
        case "while":
        case "for-of":
          return { ...statement, body: { tag: "block", statements: processBlock(statement.body.statements, live) } }
        case "function-declaration":
          return statement.body === undefined
            ? statement
            : { ...statement, body: { tag: "block", statements: processBlock(statement.body.statements, []) } }
        default:
          return statement
      }
    }

    for (let index = 0; index < list.length; index++) {
      const statement = list[index]!

      if (statement.tag === "return") {
        const moved = liveNames().filter((name) => isExactRef(statement.value, name))
        for (const name of liveNames()) {
          if (!moved.includes(name) && exprUses(statement.value, name)) {
            throw new Error(`ownership: "${name}" is used in a return value — bind the result, then return the binding`)
          }
        }
        for (const name of liveNames()) {
          if (!moved.includes(name)) out.push(freeStatement(name))
        }
        for (const binding of local) {
          if (moved.includes(binding.name)) binding.freed = true
        }
        out.push(statement)
        continue
      }

      if (statement.tag === "break" || statement.tag === "continue") {
        if (liveNames().length > 0) {
          throw new Error(
            `ownership: cannot ${statement.tag} while owned values are live (${liveNames().join(", ")}) — restructure the loop`,
          )
        }
        out.push(statement)
        continue
      }

      out.push(rebuild(statement))

      for (const binding of liveLocal()) {
        const usedHere = statementUses(statement, binding.name)
        const usedLater = list.slice(index + 1).some((later) => statementUses(later, binding.name))
        if (usedHere && !usedLater) {
          out.push(freeStatement(binding.name))
          binding.freed = true
        }
      }

      if (statement.tag === "let-declaration" || statement.tag === "const-declaration") {
        const type = statement.annotation ?? (statement.expr === undefined ? null : types.tryTypeOf(statement.expr))
        if (type !== null && isOwnedType(type)) local.push({ name: statement.name, freed: false })
      }
    }

    const last = list[list.length - 1]
    const terminal = last !== undefined && (last.tag === "return" || last.tag === "throw" || last.tag === "break" || last.tag === "continue")
    if (!terminal) {
      for (const binding of liveLocal()) {
        out.push(freeStatement(binding.name))
        binding.freed = true
      }
    }

    return out
  }

  return processBlock(statements, [])
}
