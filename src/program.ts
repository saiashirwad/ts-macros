import { inspect } from "node:util"

export interface Declaration {
  readonly tag: string
}

export interface Program<A> {
  readonly declarations: ReadonlyArray<Declaration>
  readonly result: A
}

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
