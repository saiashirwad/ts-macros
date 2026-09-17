// Every type node. Each kind is an interface, whose `TypeExpr<A>` phantom is
// the TypeScript type the node denotes (computed by core.ts), and a
// constructor, which is the only place that kind's record is written.

import { isTypeNode, makeTypeNode } from "../node.ts"
import type {
  Applied,
  ArgTypes,
  ArityError,
  CondDenote,
  Denotes,
  Fn,
  Generic,
  IndexDenote,
  Infer,
  KeyOfDenote,
  MappedDenote,
  TmplDenote,
  TypeExpr,
  Variable,
} from "./core.ts"

// primitives

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

export interface Primitive<Name extends PrimitiveName = PrimitiveName> extends TypeExpr<PrimitiveDenotations[Name]> {
  readonly tag: "primitive"
  readonly name: Name
}

const primitive = <Name extends PrimitiveName>(name: Name): Primitive<Name> => makeTypeNode({ tag: "primitive", name })

export const String = (): Primitive<"string"> => primitive("string")
export const Number = (): Primitive<"number"> => primitive("number")
export const Boolean = (): Primitive<"boolean"> => primitive("boolean")
export const Undefined = (): Primitive<"undefined"> => primitive("undefined")
export const Null = (): Primitive<"null"> => primitive("null")
export const Void = (): Primitive<"void"> => primitive("void")
export const Never = (): Primitive<"never"> => primitive("never")
export const Unknown = (): Primitive<"unknown"> => primitive("unknown")
export const Any = (): Primitive<"any"> => primitive("any")

// literals

type LiteralValue = string | number | boolean | null

export interface Literal<Value extends LiteralValue = LiteralValue> extends TypeExpr<Value> {
  readonly tag: "literal"
  readonly value: Value
}

export const Literal = <const Value extends LiteralValue>(value: Value): Literal<Value> => makeTypeNode({ tag: "literal", value })

export interface TemplateLiteralType<Parts extends readonly string[] = readonly string[], Exprs extends TypeExpr<any>[] = TypeExpr<any>[]>
  extends TypeExpr<TmplDenote<Parts, ArgTypes<Exprs>>>
{
  readonly tag: "template-literal"
  readonly parts: Parts
  readonly exprs: Exprs
}

export const TemplateLiteral = <const Parts extends readonly string[], const Exprs extends TypeExpr<any>[]>(
  parts: Parts,
  ...exprs: Exprs
): TemplateLiteralType<Parts, Exprs> => {
  if (parts.length !== exprs.length + 1) {
    throw new Error(`a template literal type with ${exprs.length} exprs needs ${exprs.length + 1} parts, got ${parts.length}`)
  }
  return makeTypeNode({ tag: "template-literal", parts, exprs })
}

// type parameters

/** a type parameter, and every later mention of it: `Param("T")` is both the `T` in `<T>` and the `T` in `value: T` */
export interface Param<
  Name extends string,
  Extends extends TypeExpr = TypeExpr<unknown>,
  A = Variable<Name> & Denotes<Extends>,
> extends TypeExpr<A> {
  readonly tag: "param"
  readonly name: Name
  readonly extends?: Extends | undefined
}

export type AnyParam = Param<string, any, any>
export type AnyParams = AnyParam[]

export const Param = <const Name extends string, Extends extends TypeExpr = TypeExpr<unknown>>(
  name: Name,
  extends_?: Extends,
): Param<Name, Extends> => makeTypeNode({ tag: "param", name, extends: extends_ })

// objects

/**
 * A field of an object type together with its modifiers. It is not a type:
 * `readonly` and `?` belong to the field, so only `Object` accepts one, and
 * `Array(Readonly(...))` does not compile.
 */
export interface Field<F extends TypeExpr<any> = TypeExpr<any>, IsReadonly extends boolean = boolean, IsOptional extends boolean = boolean> {
  readonly type: F
  readonly readonly: IsReadonly
  readonly optional: IsOptional
}

type FieldValue = TypeExpr<any> | Field

interface Fields {
  [key: string]: FieldValue
}

type TypeOf<X extends FieldValue> = X extends Field<infer F, any, any> ? F : X
type ReadonlyOf<X extends FieldValue> = X extends Field<any, infer R, any> ? R : false
type OptionalOf<X extends FieldValue> = X extends Field<any, any, infer O> ? O : false

export const isField = (value: FieldValue): value is Field => !isTypeNode(value)

/** a field with no modifiers is written as its bare type; this reads either spelling */
export const fieldOf = (value: FieldValue): Field => (isField(value) ? value : { type: value, readonly: false, optional: false })

/** `readonly key: T` */
export const Readonly = <const X extends FieldValue>(field: X): Field<TypeOf<X>, true, OptionalOf<X>> =>
  ({ ...fieldOf(field), readonly: true }) as Field<TypeOf<X>, true, OptionalOf<X>>

/** `key?: T` */
export const Optional = <const X extends FieldValue>(field: X): Field<TypeOf<X>, ReadonlyOf<X>, true> =>
  ({ ...fieldOf(field), optional: true }) as Field<TypeOf<X>, ReadonlyOf<X>, true>

type FieldMods<X extends FieldValue> = `${ReadonlyOf<X> extends true ? "ro" : ""}${OptionalOf<X> extends true ? "opt" : ""}`

type ObjectFields<F extends Fields> =
  & { readonly [K in keyof F as FieldMods<F[K]> extends "roopt" ? K : never]?: Denotes<TypeOf<F[K]>> }
  & { readonly [K in keyof F as FieldMods<F[K]> extends "ro" ? K : never]: Denotes<TypeOf<F[K]>> }
  & { [K in keyof F as FieldMods<F[K]> extends "opt" ? K : never]?: Denotes<TypeOf<F[K]>> }
  & { -readonly [K in keyof F as FieldMods<F[K]> extends "" ? K : never]: Denotes<TypeOf<F[K]>> }

export interface Object<F extends Fields = Fields> extends TypeExpr<ObjectFields<F>> {
  readonly tag: "object"
  readonly fields: F
}

export const Object = <const F extends Fields>(fields: F): Object<F> => makeTypeNode({ tag: "object", fields })

// composites

type UnionMembers = [TypeExpr<any>, TypeExpr<any>, ...TypeExpr<any>[]]

export interface Union<Members extends UnionMembers = UnionMembers> extends TypeExpr<Denotes<Members[number]>> {
  readonly tag: "union"
  readonly members: Members
}

export const Union = <const Members extends UnionMembers>(...members: Members): Union<Members> => makeTypeNode({ tag: "union", members })

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never

export interface Intersection<Members extends UnionMembers = UnionMembers> extends TypeExpr<UnionToIntersection<Denotes<Members[number]>>> {
  readonly tag: "intersection"
  readonly members: Members
}

export const Intersection = <const Members extends UnionMembers>(...members: Members): Intersection<Members> =>
  makeTypeNode({ tag: "intersection", members })

export interface ArrayType<Element extends TypeExpr<any> = TypeExpr<any>> extends TypeExpr<Array<Denotes<Element>>> {
  readonly tag: "array"
  readonly element: Element
}

export const Array = <const Element extends TypeExpr<any>>(element: Element): ArrayType<Element> => makeTypeNode({ tag: "array", element })

export interface TupleType<Items extends TypeExpr<any>[] = TypeExpr<any>[]> extends TypeExpr<ArgTypes<Items>> {
  readonly tag: "tuple"
  readonly items: Items
}

export const Tuple = <const Items extends TypeExpr<any>[]>(...items: Items): TupleType<Items> => makeTypeNode({ tag: "tuple", items })

type FnParams<Params extends TypeExpr<any>[], Rest> = [Rest] extends [TypeExpr<any>] ? [...ArgTypes<Params>, ...(Denotes<Rest> & readonly unknown[])]
  : ArgTypes<Params>

export interface FunctionType<
  Params extends TypeExpr<any>[] = TypeExpr<any>[],
  Return extends TypeExpr<any> = TypeExpr<any>,
  Rest extends TypeExpr<any> | undefined = TypeExpr<any> | undefined,
> extends TypeExpr<(...args: FnParams<Params, Rest>) => Denotes<Return>> {
  readonly tag: "function"
  readonly params: Params
  readonly return: Return
  /** the array type of a trailing rest parameter */
  readonly rest?: Rest | undefined
}

export const Function = <
  const Params extends TypeExpr<any>[],
  const Return extends TypeExpr<any>,
  const Rest extends TypeExpr<any> | undefined = undefined,
>(
  params: Params,
  returnType: Return,
  rest?: Rest,
): FunctionType<Params, Return, Rest> => makeTypeNode({ tag: "function", params, return: returnType, rest })

// type operators

export interface IndexedAccess<O extends TypeExpr<any> = TypeExpr<any>, K extends TypeExpr<any> = TypeExpr<any>>
  extends TypeExpr<IndexDenote<Denotes<O>, Denotes<K>>>
{
  readonly tag: "indexed-access"
  readonly object: O
  readonly key: K
}

export const Index = <const O extends TypeExpr<any>, const K extends TypeExpr<any>>(object: O, key: K): IndexedAccess<O, K> =>
  makeTypeNode({ tag: "indexed-access", object, key })

export interface KeyOf<T extends TypeExpr<any> = TypeExpr<any>> extends TypeExpr<KeyOfDenote<Denotes<T>>> {
  readonly tag: "keyof"
  readonly operand: T
}

export const KeyOf = <const T extends TypeExpr<any>>(operand: T): KeyOf<T> => makeTypeNode({ tag: "keyof", operand })

export interface Conditional<
  Check extends TypeExpr<any> = TypeExpr<any>,
  Pattern extends TypeExpr<any> = TypeExpr<any>,
  Then extends TypeExpr<any> = TypeExpr<any>,
  Else extends TypeExpr<any> = TypeExpr<any>,
> extends TypeExpr<CondDenote<Denotes<Check>, Denotes<Pattern>, Denotes<Then>, Denotes<Else>>> {
  readonly tag: "conditional"
  readonly check: Check
  readonly extends: Pattern
  readonly then: Then
  readonly else: Else
}

export const Conditional = <
  const C extends TypeExpr<any>,
  const P extends TypeExpr<any>,
  const T extends TypeExpr<any>,
  const E extends TypeExpr<any>,
>(
  check: C,
  pattern: P,
  then: T,
  else_: E,
): Conditional<C, P, T, E> => makeTypeNode({ tag: "conditional", check, extends: pattern, then, else: else_ })

/** `infer Name`, for use inside a conditional's pattern; the then-branch refers to it as `Param(Name)` */
export interface InferVar<Name extends string = string> extends TypeExpr<Infer<Name>> {
  readonly tag: "infer-var"
  readonly name: Name
}

export const InferVar = <const Name extends string>(name: Name): InferVar<Name> => makeTypeNode({ tag: "infer-var", name })

/** `{ [Key in keyof Source]: Body }`; refer to the key inside `body` with `Param(key)` */
export interface Mapped<K extends string = string, Source extends TypeExpr<any> = TypeExpr<any>, F extends TypeExpr<any> = TypeExpr<any>>
  extends TypeExpr<MappedDenote<Denotes<Source>, Denotes<F>, K>>
{
  readonly tag: "mapped"
  readonly key: K
  readonly source: Source
  readonly body: F
}

export const Mapped = <const K extends string, const Source extends TypeExpr<any>, const F extends TypeExpr<any>>(
  key: K,
  source: Source,
  body: F,
): Mapped<K, Source, F> => makeTypeNode({ tag: "mapped", key, source, body })

// references to named types

export interface TypeRef<A = unknown> extends TypeExpr<A> {
  readonly tag: "type-ref"
  readonly name: string
  readonly args: TypeExpr<any>[]
}

export const Ref = <A = unknown>(name: string, ...args: TypeExpr<any>[]): TypeRef<A> => makeTypeNode({ tag: "type-ref", name, args })

/** applies a declared generic type to arguments; the result is a reference to `callee` with those args */
export const Apply = <Callee extends TypeRef<any>, const Args extends TypeExpr<any>[]>(
  callee: Callee,
  args: Args,
  ..._check: [Applied<Callee, Args>] extends [ArityError<any, any>] ? [Applied<Callee, Args>] : []
): TypeRef<Applied<Callee, Args>> => Ref(callee.name, ...args)

type PromiseRef = TypeRef<Fn<[Param<"T">], Generic<"Promise", [Variable<"T">]>>>

/** the host `Promise<A>`; like `Array`, but a reference, because a promise has no structure to spell */
export const Promise = <const A extends TypeExpr<any>>(value: A): TypeRef<Applied<PromiseRef, [A]>> => Ref("Promise", value)

/** every type node kind, so passes and emitters can switch exhaustively */
export type Any =
  | Primitive
  | Literal
  | TemplateLiteralType
  | AnyParam
  | InferVar
  | Object
  | Union
  | Intersection
  | ArrayType
  | TupleType
  | FunctionType
  | IndexedAccess
  | KeyOf
  | Conditional
  | Mapped
  | TypeRef<any>
