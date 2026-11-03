export interface TypeLambda {
  readonly Args: readonly unknown[]
  readonly type: unknown
}

export type Kind<F extends TypeLambda, Args extends readonly unknown[]> = (F & { readonly Args: Args })["type"]

export type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false

export type Accepts<Output> =
    [Output] extends [never] ? false
  : [Output] extends [true] ? true
  : false

export interface Assignable extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer From, infer To] ? ([From] extends [To] ? true : false) : false
}

export interface Same extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? Equal<A, B> : false
}

export interface Both<Class> extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? ([A, B] extends [Class, Class] ? true : false) : false
}

export interface Under<Pattern extends TypeLambda, Rule extends TypeLambda> extends TypeLambda {
  readonly type: this["Args"] extends readonly [infer A, infer B] ? Parts<Kind<Pattern, [A]>, Kind<Pattern, [B]>, Rule> : false
}
type Parts<PA, PB, Rule extends TypeLambda> =
    [PA] extends [never] ? false
  : [PB] extends [never] ? false
  : [PA, PB] extends [readonly [infer X], readonly [infer Y]] ? Kind<Rule, [X, Y]>
  : false

export interface AnyOf<A extends TypeLambda, B extends TypeLambda> extends TypeLambda {
  readonly type: Accepts<Kind<A, this["Args"]>> extends true ? true : Kind<B, this["Args"]>
}

export interface Not<A extends TypeLambda> extends TypeLambda {
  readonly type: Accepts<Kind<A, this["Args"]>> extends true ? false : true
}

export type Check<Ok, Message extends string, Details = unknown> = Accepts<Ok> extends true ? unknown : Rejected<Message, Details>

export type Rejected<Message extends string, Details = unknown> = { readonly error: Message } & Details
