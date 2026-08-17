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
    if (node.tag !== "external-ref") return
    const external = node as unknown as Expr.ExternalRef<any>
    if (external.source === undefined) return
    const existing = found.get(external.name)
    if (existing !== undefined && existing.source !== external.source) {
      throw new Error(`import local "${external.name}" refers to both "${existing.source}" and "${external.source}"`)
    }
    if (existing === undefined) found.set(external.name, { local: external.name, source: external.source })
  })

  return [...found.values()]
}
