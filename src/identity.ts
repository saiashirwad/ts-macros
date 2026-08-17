import { randomUUID } from "node:crypto"

declare const BindingIdType: unique symbol

export type BindingId = string & { readonly [BindingIdType]: true }

export const freshBindingId = (): BindingId => randomUUID() as BindingId
