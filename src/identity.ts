import { randomUUID } from "node:crypto"

// A binding is identified by its id, never by its name. `nameHint` is only
// what the user asked it to be called; scope.ts picks the emitted name.

declare const BindingIdType: unique symbol

export type BindingId = string & { readonly [BindingIdType]: true }

export interface ValueBinding {
  readonly id: BindingId
  readonly nameHint: string
}

export interface ValueReference {
  readonly target: BindingId
  readonly nameHint: string
}

export const freshBindingId = (): BindingId => randomUUID() as BindingId

/** the name hint of a binding the user did not name; any number of them may share a scope */
export const ANONYMOUS = "anon"
