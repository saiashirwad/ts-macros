/**
 * A rule is a type-level function written as a type lambda: an interface whose `type` reads its
 * arguments from `this["Args"]`. Typing rules, conversions and analyses are all rules.
 */
export interface TypeLambda {
  readonly Args: readonly unknown[]
  readonly type: unknown
}

/** applies a rule to its arguments */
export type Kind<F extends TypeLambda, Args extends readonly unknown[]> = (F & { readonly Args: Args })["type"]

export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

/** `true` only when the rule's output is exactly `true`; `boolean`, `false` and `never` all reject */
export type Accepts<Output> =
    [Output] extends [never] ? false
  : [Output] extends [true] ? true
  : false

/** `[From, To]`: TypeScript assignability */
export interface Assignable extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer From, infer To] ? ([From] extends [To] ? true : false) : false
}

/** `[A, B]`: exactly the same type */
export interface Same extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? Equal<A, B> : false
}

/** `[A, B]`: both belong to `Class` */
export interface Both<Class> extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? ([A, B] extends [Class, Class] ? true : false) : false
}

/**
 * `[A, B]`: applies `Rule` to the parts `Pattern` extracts from each argument. `Pattern` maps `[X]` to a
 * one-element tuple of the part, or to `never` when there is no part, in which case the rule rejects.
 */
export interface Under<Pattern extends TypeLambda, Rule extends TypeLambda> extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? Parts<Kind<Pattern, [A]>, Kind<Pattern, [B]>, Rule> : false
}
type Parts<PA, PB, Rule extends TypeLambda> =
    [PA] extends [never] ? false
  : [PB] extends [never] ? false
  : [PA, PB] extends [readonly [infer X], readonly [infer Y]] ? Kind<Rule, [X, Y]>
  : false

/** either rule accepts */
export interface AnyOf<A extends TypeLambda, B extends TypeLambda> extends TypeLambda {
  readonly type: Accepts<Kind<A, this["Args"]>> extends true ? true : Kind<B, this["Args"]>
}

/** the rule rejects */
export interface Not<A extends TypeLambda> extends TypeLambda {
  readonly type: Accepts<Kind<A, this["Args"]>> extends true ? false : true
}

/**
 * Intersected with a parameter, a rejected rule makes every argument an error that names the problem.
 * The message is an object brand, so it survives intersection where a string literal would collapse to `never`.
 */
export type Check<Ok, Message extends string, Details = unknown> = Accepts<Ok> extends true ? unknown : Rejected<Message, Details>

/** a rejected result: where a statement was expected, `yield*` reports it with its message */
export type Rejected<Message extends string, Details = unknown> = { readonly error: Message } & Details
