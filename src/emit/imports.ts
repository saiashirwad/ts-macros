import type { Statement } from "../statement.ts"
import { walk } from "../walk.ts"

export interface ImportBinding {
  readonly local: string
  readonly source: string
}

export const collectImports = (statements: ReadonlyArray<Statement>): ImportBinding[] => {
  const found = new Map<string, ImportBinding>()
  const globals = new Set<string>()

  walk(statements, (node) => {
    if (node.kind !== "external") return
    const external = node
    if (external.source === undefined) {
      if (found.has(external.name)) throw new Error(`external name "${external.name}" refers to both an import and a global`)
      globals.add(external.name)
      return
    }
    if (globals.has(external.name)) throw new Error(`external name "${external.name}" refers to both an import and a global`)
    const existing = found.get(external.name)
    if (existing !== undefined && existing.source !== external.source) {
      throw new Error(`import local "${external.name}" refers to both "${existing.source}" and "${external.source}"`)
    }
    if (existing === undefined) found.set(external.name, { local: external.name, source: external.source })
  })

  return [...found.values()]
}
