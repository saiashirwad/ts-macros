// Compile-time checks.
//
// A check is a tuple type: `[]` when it passes, `[message, ...details]` when
// it fails. It is spread into a trailing rest parameter,
// `..._check: [...CheckA<X>, ...CheckB<Y>]`, so a failure demands arguments
// nobody passes and the editor shows the message. Where the checked value is
// itself a parameter, `Guard` intersects the check onto it instead.

/** a check in intersection position: no constraint when it passes, the error tuple when it fails */
export type Guard<Check extends unknown[]> = [Check] extends [[]] ? unknown : Check

declare const FailedCheckId: unique symbol

/** a failed result check is diagnostic data, never a liftable stage-2 value */
// The string-keyed unique-symbol value prevents erasure into liftable records.
// The symbol key retains diagnostic data; erased object types remain forbidden.
export type FailedCheck<Check extends unknown[] = unknown[]> =
  | { readonly failedCheck: typeof FailedCheckId; readonly [FailedCheckId]: Check }
  | undefined
