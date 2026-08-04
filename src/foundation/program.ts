import type { Declaration } from "./declaration"

export interface Program<A> {
  readonly declarations: ReadonlyArray<Declaration>
  readonly result: A
}
