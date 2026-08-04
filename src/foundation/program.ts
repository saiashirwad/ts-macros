import type { Declaration } from "./declaration.ts"

export interface Program<A> {
  readonly declarations: ReadonlyArray<Declaration>
  readonly result: A
}
