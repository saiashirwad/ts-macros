import type * as Expr from "../expr.ts"
import type { Statement } from "../statement.ts"
import { walk } from "../walk.ts"

export interface ImportBinding {
  readonly local: string
  readonly source: string
}

export const collectImports = (statements: ReadonlyArray<Statement>): ImportBinding[] => {
  const found = new Map<string, ImportBinding>()

  walk(statements, (node) => {
    if (node.tag === "var-ref") {
      const varRef = node as unknown as Expr.VarRef<any, any>
      if (varRef.source !== undefined) {
        const existing = found.get(varRef.name)
        if (existing !== undefined && existing.source !== varRef.source) {
          throw new Error(`import local "${varRef.name}" refers to both "${existing.source}" and "${varRef.source}"`)
        }
        if (existing === undefined) found.set(varRef.name, { local: varRef.name, source: varRef.source })
      }
    }
  })

  return [...found.values()]
}
