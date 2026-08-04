import { inspect } from "node:util"

import type { Declaration } from "../foundation/declaration.ts"
import type { Program } from "../foundation/program.ts"

export function runMacro<A>(factory: () => Generator<Declaration, A, unknown>): Program<A> {
  const iterator = factory()
  const declarations: Declaration[] = []

  while (true) {
    const next = iterator.next()

    console.log(
      inspect(
        {
          declarations,
          result: next.value,
        },
        {
          depth: null,
          colors: true,
        },
      ),
    )

    if (next.done) {
      return {
        declarations,
        result: next.value,
      }
    }

    declarations.push(next.value)
  }
}
