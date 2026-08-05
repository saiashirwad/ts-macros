import { makePipeable, PipeableClass, type Pipeable } from "./pipeable.ts"

declare const TypeExprTypeId: unique symbol

export interface TypeExpr<A = unknown> extends Pipeable {
  readonly [TypeExprTypeId]?: A
}

declare const TypeVariableId: unique symbol

export type TypeVariableId = typeof TypeVariableId

export interface Variable<Name extends string = string> {
  readonly [TypeVariableId]: Name
}

export interface Param<
  Name extends string,
  Extends extends TypeExpr,
  A = Variable<Name>,
> extends TypeExpr<A> {
  readonly tag: "param"
  readonly name: Name
  readonly extends?: Extends | undefined
}

export type AnyParam = Param<string, any>
export type AnyParams = AnyParam[]

export interface Fn<Params extends AnyParams = AnyParams, Body = unknown> {
  readonly params: Params
  readonly body: Body
}

export type Declared<Params extends AnyParams, Body> = Params extends [] ? Body : Fn<Params, Body>

type LiteralValue = string | number | boolean | null

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

export interface ArrayType<Element extends TypeExpr<any> = TypeExpr<any>> extends TypeExpr<
  Array<Denotes<Element>>
> {
  readonly tag: "array"
  readonly element: Element
}

export interface TupleType<Items extends TypeExpr<any>[] = TypeExpr<any>[]> extends TypeExpr<
  ArgTypes<Items>
> {
  readonly tag: "tuple"
  readonly items: Items
}

export interface FunctionType<
  Params extends TypeExpr<any>[] = TypeExpr<any>[],
  Return extends TypeExpr<any> = TypeExpr<any>,
> extends TypeExpr<(...args: ArgTypes<Params>) => Denotes<Return>> {
  readonly tag: "function"
  readonly params: Params
  readonly return: Return
}

export interface TypeRef<A = unknown> extends TypeExpr<A> {
  readonly tag: "type-ref"
  readonly name: string
  readonly args?: TypeExpr<any>[] | undefined
}

interface PrimitiveDenotations {
  readonly string: string
  readonly number: number
  readonly boolean: boolean
  readonly undefined: undefined
  readonly null: null
  readonly void: void
  readonly never: never
  readonly unknown: unknown
  readonly any: any
}

export type PrimitiveName = keyof PrimitiveDenotations

export interface Primitive<Name extends PrimitiveName = PrimitiveName> extends TypeExpr<
  PrimitiveDenotations[Name]
> {
  readonly tag: "primitive"
  readonly name: Name
}

export type StringType = Primitive<"string">
export type NumberType = Primitive<"number">
export type BooleanType = Primitive<"boolean">
export type UndefinedType = Primitive<"undefined">
export type NullType = Primitive<"null">
export type VoidType = Primitive<"void">
export type NeverType = Primitive<"never">
export type UnknownType = Primitive<"unknown">
export type AnyType = Primitive<"any">

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
: Body extends (...args: infer FnArgs) => infer Result ? (...args: SubstituteTuple<FnArgs, Params, Args>) => Substitute<Result, Params, Args>
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

export const Param = <const Name extends string, Extends extends TypeExpr>(
  name: Name,
  _extends?: Extends,
): Param<Name, Extends> => makePipeable({ tag: "param", name, extends: _extends })

export const Literal = <const Value extends LiteralValue>(value: Value): Literal<Value> =>
  makePipeable({ tag: "literal", value })

export const Object = <const F extends Fields>(fields: F): Object<F> =>
  makePipeable({ tag: "object", fields })

export const Union = <const Members extends UnionMembers>(...members: Members): Union<Members> =>
  makePipeable({ tag: "union", members })

export const Array = <const Element extends TypeExpr<any>>(element: Element): ArrayType<Element> =>
  makePipeable({ tag: "array", element })

export const Tuple = <const Items extends TypeExpr<any>[]>(...items: Items): TupleType<Items> =>
  makePipeable({ tag: "tuple", items })

export const Function = <const Params extends TypeExpr<any>[], const Return extends TypeExpr<any>>(
  params: Params,
  returnType: Return,
): FunctionType<Params, Return> => makePipeable({ tag: "function", params, return: returnType })

export const Ref = <A = unknown>(name: string, ...args: TypeExpr<any>[]): TypeRef<A> =>
  makePipeable({ tag: "type-ref", name, args })

export const Apply = <Callee extends TypeExpr<any>, const Args extends TypeExpr<any>[]>(
  callee: Callee,
  args: Args,
): Application<Apply<Callee, Args>> => makePipeable({ tag: "application", callee, args })

export const String = (): StringType => makePipeable({ tag: "primitive", name: "string" })

export const Number = (): NumberType => makePipeable({ tag: "primitive", name: "number" })

export const Boolean = (): BooleanType => makePipeable({ tag: "primitive", name: "boolean" })

export const Undefined = (): UndefinedType => makePipeable({ tag: "primitive", name: "undefined" })

export const Null = (): NullType => makePipeable({ tag: "primitive", name: "null" })

export const Void = (): VoidType => makePipeable({ tag: "primitive", name: "void" })

export const Never = (): NeverType => makePipeable({ tag: "primitive", name: "never" })

export const Unknown = (): UnknownType => makePipeable({ tag: "primitive", name: "unknown" })

export const Any = (): AnyType => makePipeable({ tag: "primitive", name: "any" })

export interface TypeDeclaration<Body = unknown, Params extends AnyParams = []> {
  readonly tag: "type-declaration"
  readonly name: string
  readonly params: Params
  readonly body?: TypeExpr<Body>
}

export class TypeBuilder<Body = unknown, Params extends AnyParams = []> extends PipeableClass() {
  readonly spec: TypeDeclaration<Body, Params>

  constructor(spec: TypeDeclaration<Body, Params>) {
    super()
    this.spec = spec
  }

  withSpec<Body, Params extends AnyParams>(spec: TypeDeclaration<Body, Params>) {
    return new TypeBuilder(spec)
  }

  *[Symbol.iterator](): Generator<
    TypeDeclaration<Body, Params>,
    TypeRef<Declared<Params, Body>>,
    unknown
  > {
    yield {
      tag: "type-declaration",
      name: this.spec.name,
      params: this.spec.params,
      ...(this.spec.body === undefined ? {} : { body: this.spec.body }),
    }

    return makePipeable({ tag: "type-ref", name: this.spec.name })
  }
}

export const Type = (name: string): TypeBuilder<unknown, []> =>
  new TypeBuilder({ tag: "type-declaration", name, params: [] })

export const Body =
  <Body>(body: TypeExpr<Body>) =>
  <Params extends AnyParams>(builder: TypeBuilder<any, Params>) =>
    builder.withSpec<Body, Params>({ ...builder.spec, body })

export const TypeParams =
  <const Params extends AnyParams>(...params: Params) =>
  <Body>(builder: TypeBuilder<Body, any>) =>
    builder.withSpec({ ...builder.spec, params })
