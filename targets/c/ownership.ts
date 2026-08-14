import type { Synthesis } from "../../src/emit/index.ts"
import type * as Expr from "../../src/expr.ts"
import * as FFI from "../../src/ffi.ts"
import * as Fn from "../../src/function.ts"
import { Do, type Statement } from "../../src/statement.ts"
import * as Type from "../../src/types/index.ts"
import { walk } from "../../src/walk.ts"
import { isOwnedType, ownedFlavor } from "../c-family/index.ts"

export { isOwnedType, type Owned, owned } from "../c-family/index.ts"

// a free policy turns a binding's release function into a statement; the
// flavor comes from the Owned brand (owned(t, "cudaFree") => flavor
// "cudaFree"). The default spells the flavor as a plain call, so the
// default flavor "free" emits free(name) — the pre-policy behavior.
export type FreePolicy = (flavor: string, name: string) => Statement

const freeStatement: FreePolicy = (flavor, name) => Do(Fn.Call(FFI.Value<(pointer: any) => void>(flavor), FFI.Value(name)))

const uses = (root: Statement | Expr.Expr<any>, name: string): boolean => {
  let found = false
  walk(root, (node) => {
    if (node.tag === "var-ref" && (node as { readonly name?: string }).name === name) found = true
  })
  return found
}

const isExactRef = (expr: Expr.Expr<any>, name: string): boolean => {
  const node = expr as unknown as { readonly tag: string; readonly name?: string }
  return node.tag === "var-ref" && node.name === name
}

interface LocalOwned {
  readonly name: string
  readonly flavor: string
  freed: boolean
}

// frees every Owned binding exactly once on every path: after its last use
// in the declaring block, before any return that does not move it, at block
// end if never used. `return x` moves ownership to the caller.
export const insertFrees = (statements: ReadonlyArray<Statement>, types: Synthesis, free: FreePolicy = freeStatement): Statement[] => {
  const processBlock = (list: ReadonlyArray<Statement>, enclosing: readonly LocalOwned[]): Statement[] => {
    const local: LocalOwned[] = []
    const liveLocal = () => local.filter((binding) => !binding.freed)
    const liveBindings = () => [...enclosing, ...liveLocal()]
    const liveNames = () => liveBindings().map((binding) => binding.name)
    const out: Statement[] = []

    const rebuild = (statement: Statement): Statement => {
      const live = liveBindings()
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
          if (!moved.includes(name) && uses(statement.value, name)) {
            throw new Error(`ownership: "${name}" is used in a return value — bind the result, then return the binding`)
          }
        }
        for (const binding of liveBindings()) {
          if (!moved.includes(binding.name)) out.push(free(binding.flavor, binding.name))
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
        const usedHere = uses(statement, binding.name)
        const usedLater = list.slice(index + 1).some((later) => uses(later, binding.name))
        if (usedHere && !usedLater) {
          out.push(free(binding.flavor, binding.name))
          binding.freed = true
        }
      }

      if (statement.tag === "binding") {
        const type = statement.annotation ?? (statement.expr === undefined ? null : types.tryTypeOf(statement.expr))
        if (type !== null && isOwnedType(type)) local.push({ name: statement.name, flavor: ownedFlavor(type), freed: false })
      }
    }

    const last = list[list.length - 1]
    const terminal = last !== undefined && (last.tag === "return" || last.tag === "throw" || last.tag === "break" || last.tag === "continue")
    if (!terminal) {
      for (const binding of liveLocal()) {
        out.push(free(binding.flavor, binding.name))
        binding.freed = true
      }
    }

    return out
  }

  return processBlock(statements, [])
}
