import { makePipeable, type Pipeable } from "./pipeable.ts"

declare const TypeExprTypeId: unique symbol

export interface TypeExpr<A = unknown> extends Pipeable {
  readonly [TypeExprTypeId]?: A
}

declare const TypeVariableId: unique symbol

export type TypeVariableId = typeof TypeVariableId

export interface Variable<Name extends string = string> {
  readonly [TypeVariableId]: Name
}

export interface Param<Name extends string = string, A = Variable<Name>> extends TypeExpr<A> {
  readonly tag: "param"
  readonly name: Name
}

export type AnyParam = Param<string, any>
export type AnyParams = AnyParam[]

export interface Fn<Params extends AnyParams = AnyParams, Body = unknown> {
  readonly params: Params
  readonly body: Body
}

export type Declared<Params extends AnyParams, Body> = Params extends [] ? Body : Fn<Params, Body>

type LiteralValue = string | number | boolean

export interface Literal<Value extends LiteralValue = LiteralValue> extends TypeExpr<Value> {
  readonly tag: "literal"
  readonly value: Value
}

interface Fields {
  [key: string]: TypeExpr<any>
}

type ObjectShape<F extends Fields> = {
  // readonly [K in keyof F]: F[K] extends TypeExpr<infer A> ? A : never
  [K in keyof F]: Denotes<F[K]>
}

export interface Object<F extends Fields = Fields> extends TypeExpr<ObjectShape<F>> {
  readonly tag: "object"
  readonly fields: F
}

type UnionMembers = [TypeExpr<any>, TypeExpr<any>, ...TypeExpr<any>[]]

type UnionShape<Members extends TypeExpr<any>[]> =
  Members[number] extends TypeExpr<infer A> ? A : never

export interface Union<Members extends UnionMembers> extends TypeExpr<UnionShape<Members>> {
  readonly tag: "union"
  readonly members: Members
}

export interface TypeRef<A = unknown> extends TypeExpr<A> {
  readonly tag: "type-ref"
  readonly name: string
}

export interface StringType extends TypeExpr<string> {
  readonly tag: "string-type"
}

export interface NumberType extends TypeExpr<number> {
  readonly tag: "number-type"
}

type Denotes<T extends TypeExpr<any>> = T extends TypeExpr<infer A> ? A : never

export type ArgTypes<Args extends TypeExpr<any>[]> = {
  [K in keyof Args]: Denotes<Args[K]>
}

type ResolveArg<
  Params extends AnyParams,
  Args extends unknown[],
  Name extends string,
> = Params extends [infer Head extends AnyParam, ...infer Tail extends AnyParams]
  ? Args extends [infer Arg, ...infer Rest extends unknown[]]
    ? Head["name"] extends Name
      ? Arg
      : ResolveArg<Tail, Rest, Name>
    : never
  : never

type SubstituteTuple<
  Items extends unknown[],
  Params extends AnyParams,
  Args extends unknown[],
> = Items extends [infer Head, ...infer Tail extends unknown[]]
  ? [Substitute<Head, Params, Args>, ...SubstituteTuple<Tail, Params, Args>]
  : []

// oxfmt-ignore
export type Substitute<Body, Params extends AnyParams, Args extends unknown[]> =
  Body extends Variable<infer Name> ? ResolveArg<Params, Args, Name>
: Body extends (...args: infer FnParams) => infer Result ? (...args: SubstituteTuple<FnParams, Params, Args>) => Substitute<Result, Params, Args>
: Body extends [unknown, ...unknown[]] ? SubstituteTuple<Body, Params, Args>
: Body extends Array<infer Item> ? Array<Substitute<Item, Params, Args>>
: Body extends object ? { [K in keyof Body]: Substitute<Body[K], Params, Args> }
: Body;

export type Apply<Callee extends TypeExpr<any>, Args extends TypeExpr<any>[]> =
  Denotes<Callee> extends Fn<infer Params, infer Body>
    ? Args["length"] extends Params["length"]
      ? Substitute<Body, Params, ArgTypes<Args>>
      : never
    : never

export interface Application<A = unknown> extends TypeExpr<A> {
  readonly tag: "application"
  readonly callee: TypeExpr<any>
  readonly args: Array<TypeExpr<any>>
}

export const Param = <const Name extends string>(name: Name): Param<Name> =>
  makePipeable({ tag: "param", name })

export const Literal = <const Value extends LiteralValue>(value: Value): Literal<Value> =>
  makePipeable({ tag: "literal", value })

export const Object = <const F extends Fields>(fields: F): Object<F> =>
  makePipeable({ tag: "object", fields })

export const Union = <const Members extends UnionMembers>(...members: Members): Union<Members> =>
  makePipeable({ tag: "union", members })

export const Apply = <Callee extends TypeExpr<any>, const Args extends TypeExpr<any>[]>(
  callee: Callee,
  args: Args,
): Application<Apply<Callee, Args>> => makePipeable({ tag: "application", callee, args })

export const String = (): StringType => makePipeable({ tag: "string-type" })

export const Number = (): NumberType => makePipeable({ tag: "number-type" })
