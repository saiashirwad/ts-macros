import type { BindingId } from "../identity.ts"
import type { Statement } from "../statement.ts"
import { visitValueScopes } from "./index.ts"

export const validateScopes = (statements: ReadonlyArray<Statement>): void => {
  const declarations = new Set<BindingId>()

  visitValueScopes(statements, new Set<BindingId>(), {
    enterScope: (bindings, parent) => {
      const visible = new Set(parent)
      const localNames = new Set<string>()

      for (const binding of bindings) {
        if (declarations.has(binding.id)) {
          throw new Error(`binding "${binding.nameHint}" is declared more than once with the same identity`)
        }
        if (localNames.has(binding.nameHint)) {
          throw new Error(`"${binding.nameHint}" is already declared in this scope`)
        }
        declarations.add(binding.id)
        localNames.add(binding.nameHint)
        visible.add(binding.id)
      }

      return visible
    },
    reference: (reference, visible) => {
      if (!visible.has(reference.target)) {
        throw new Error(`reference to "${reference.nameHint}" does not resolve to an in-scope binding`)
      }
    },
  })
}
