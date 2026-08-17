import type * as Expr from "../expr.ts"
import type { BindingId } from "../identity.ts"
import { visitValueScopes } from "../scope/index.ts"
import type { Statement } from "../statement.ts"
import { walk } from "../walk.ts"

export type BindingNames = ReadonlyMap<BindingId, string>

const freshName = (nameHint: string, used: Set<string>): string => {
  if (!used.has(nameHint)) {
    used.add(nameHint)
    return nameHint
  }
  let suffix = 2
  while (used.has(`${nameHint}_${suffix}`)) suffix++
  const name = `${nameHint}_${suffix}`
  used.add(name)
  return name
}

export const collectBindingNames = (statements: ReadonlyArray<Statement>): BindingNames => {
  const names = new Map<BindingId, string>()
  const externalNames = new Set<string>()

  walk(statements, (node) => {
    if (node.tag === "external-ref") {
      externalNames.add((node as unknown as Expr.ExternalRef<any>).name)
    }
  })

  visitValueScopes(statements, externalNames, {
    enterScope: (bindings, parent) => {
      const used = new Set(parent)
      for (const binding of bindings) {
        if (!names.has(binding.id)) names.set(binding.id, freshName(binding.nameHint, used))
      }
      return used
    },
    reference: () => {},
  })

  return names
}

export const resolveBindingName = (names: BindingNames | undefined, id: BindingId, nameHint: string): string => names?.get(id) ?? nameHint
