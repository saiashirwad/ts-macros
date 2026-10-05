import { randomUUID } from "node:crypto"

declare const BindingIdType: unique symbol

export type BindingId = string & { readonly [BindingIdType]: true }

export interface ValueBinding {
  readonly id: BindingId
  readonly nameHint: string
}

export const freshBindingId = (): BindingId => randomUUID() as BindingId
