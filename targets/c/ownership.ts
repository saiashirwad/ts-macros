import type { Synthesis } from "../../src/emit/index.ts"
import * as Expr from "../../src/expr.ts"
import * as FFI from "../../src/ffi.ts"
import * as Fn from "../../src/function.ts"
import type { BindingId } from "../../src/identity.ts"
import { Do, mapChildStatements, type Statement } from "../../src/statement.ts"
import { walk } from "../../src/walk.ts"
import { isOwnedType, ownedFlavor } from "../c-family/index.ts"

export { isOwnedType, type Owned, owned } from "../c-family/index.ts"

export type FreePolicy = (flavor: string, value: Expr.VarRef<any, any>) => Statement

const freeStatement: FreePolicy = (flavor, value) => Do(Fn.Call(FFI.Value<(pointer: any) => void>(flavor), value))

const bindingsIn = (root: Statement | Expr.Expr<any>): ReadonlySet<BindingId> => {
  const found = new Set<BindingId>()
  walk(root, (node) => {
    if (node.tag === "var-ref") found.add((node as Expr.VarRef).target)
  })
  return found
}

const isExactRef = (expr: Expr.Expr<any>, target: BindingId): boolean => {
  const node = expr as { readonly tag?: string; readonly target?: BindingId }
  return node.tag === "var-ref" && node.target === target
}

interface LocalOwned {
  readonly id: BindingId
  readonly nameHint: string
  readonly flavor: string
  freed: boolean
}

const refOf = (binding: LocalOwned): Expr.VarRef<any, any> => Expr.LocalRef(binding.id, binding.nameHint)

// frees every Owned binding exactly once on every path: after its last use
// in the declaring block, before any return that does not move it, at block
// end if never used. `return x` moves ownership to the caller.
export const insertFrees = (statements: ReadonlyArray<Statement>, types: Synthesis, free: FreePolicy = freeStatement): Statement[] => {
  const processBlock = (list: ReadonlyArray<Statement>, enclosing: readonly LocalOwned[]): Statement[] => {
    const local: LocalOwned[] = []
    const liveLocal = () => local.filter((binding) => !binding.freed)
    const liveBindings = () => [...enclosing, ...liveLocal()]
    const liveIds = () => liveBindings().map((binding) => binding.id)
    const out: Statement[] = []

    const bindings = list.map(bindingsIn)
    const usedAfter: ReadonlySet<BindingId>[] = []
    let after = new Set<BindingId>()
    for (let index = list.length - 1; index >= 0; index--) {
      usedAfter[index] = after
      after = new Set([...after, ...bindings[index]!])
    }

    const rebuild = (statement: Statement): Statement =>
      mapChildStatements(statement, (body) => processBlock(body, statement.tag === "function-declaration" ? [] : liveBindings()))

    for (let index = 0; index < list.length; index++) {
      const statement = list[index]!

      if (statement.tag === "return") {
        const returned = bindingsIn(statement.value)
        const moved = liveBindings().filter((binding) => isExactRef(statement.value, binding.id)).map((binding) => binding.id)
        for (const binding of liveBindings()) {
          if (!moved.includes(binding.id) && returned.has(binding.id)) {
            throw new Error(`ownership: "${binding.nameHint}" is used in a return value — bind the result, then return the binding`)
          }
        }
        for (const binding of liveBindings()) {
          if (!moved.includes(binding.id)) out.push(free(binding.flavor, refOf(binding)))
        }
        for (const binding of local) {
          if (moved.includes(binding.id)) binding.freed = true
        }
        out.push(statement)
        continue
      }

      if (statement.tag === "break" || statement.tag === "continue") {
        if (liveIds().length > 0) {
          throw new Error(
            `ownership: cannot ${statement.tag} while owned values are live (${
              liveBindings().map((binding) => binding.nameHint).join(", ")
            }) — restructure the loop`,
          )
        }
        out.push(statement)
        continue
      }

      out.push(rebuild(statement))

      for (const binding of liveLocal()) {
        const usedHere = bindings[index]!.has(binding.id)
        const usedLater = usedAfter[index]!.has(binding.id)
        if (usedHere && !usedLater) {
          out.push(free(binding.flavor, refOf(binding)))
          binding.freed = true
        }
      }

      if (statement.tag === "let-declaration" || statement.tag === "const-declaration") {
        const type = statement.annotation ?? statement.type ?? (statement.expr === undefined ? null : types.tryTypeOf(statement.expr))
        if (type !== null && isOwnedType(type)) {
          local.push({ id: statement.id, nameHint: statement.nameHint, flavor: ownedFlavor(type), freed: false })
        }
      }
    }

    const last = list[list.length - 1]
    const terminal = last !== undefined && (last.tag === "return" || last.tag === "throw" || last.tag === "break" || last.tag === "continue")
    if (!terminal) {
      for (const binding of liveLocal()) {
        out.push(free(binding.flavor, refOf(binding)))
        binding.freed = true
      }
    }

    return out
  }

  return processBlock(statements, [])
}
