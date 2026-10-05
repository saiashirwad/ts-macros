export type Guard<Check extends unknown[]> = [Check] extends [[]] ? unknown : Check

declare const FailedCheckId: unique symbol

export type FailedCheck<Check extends unknown[] = unknown[]> =
  | { readonly failedCheck: typeof FailedCheckId; readonly [FailedCheckId]: Check }
  | undefined
