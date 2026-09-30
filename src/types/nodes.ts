// Every type node. Each kind is an interface, whose `Type<A>` phantom is
// the TypeScript type the node denotes (computed by core.ts), and a
// constructor, which is the only place that kind's record is written.

import type { Guard } from "../check.ts"
import type { ValueBinding } from "../identity.ts"
import { isType, makeType } from "../node.ts"
import type {
  Applied,
  ArgTypes,
  ArityError,
  CondDenote,
  ConstraintError,
  Denotes,
  Fn,
  Generic,
  IndexDenote,
  Infer,
  IsAny,
  KeyOfDenote,
  LogicalDenote,
  MappedDenote,
  TemplateInterpolation,
  TemplateInterpolationError,
  TmplDenote,
  Type,
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

export interface Primitive<Name extends PrimitiveName = PrimitiveName> extends Type<PrimitiveDenotations[Name]> {
  readonly kind: "primitive"
  readonly name: Name
}

const primitive = <Name extends PrimitiveName>(name: Name): Primitive<Name> => makeType({ kind: "primitive", name })

/** the primitive types, one shared node each */
export const string: Primitive<"string"> = primitive("string")
export const number: Primitive<"number"> = primitive("number")
export const boolean: Primitive<"boolean"> = primitive("boolean")
export const undefined_: Primitive<"undefined"> = primitive("undefined")
export const null_: Primitive<"null"> = primitive("null")
export const void_: Primitive<"void"> = primitive("void")
export const never: Primitive<"never"> = primitive("never")
export const unknown: Primitive<"unknown"> = primitive("unknown")
export const any: Primitive<"any"> = primitive("any")

// literals

type LiteralValue = string | number | boolean | null

export interface Literal<Value extends LiteralValue = LiteralValue> extends Type<Value> {
  readonly kind: "literal"
  readonly value: Value
}

export const literal = <const Value extends LiteralValue>(value: Value): Literal<Value> => {
  if (typeof value === "number" && !globalThis.Number.isFinite(value)) {
    throw new Error(`literal number must be finite, got ${globalThis.String(value)}`)
  }
  return makeType({ kind: "literal", value })
}

export interface TemplateLiteralType<Parts extends readonly string[] = readonly string[], Exprs extends Type<any>[] = Type<any>[]>
  extends Type<TmplDenote<Parts, ArgTypes<Exprs>>>
{
  readonly kind: "template-literal"
  readonly parts: Parts
  readonly exprs: Exprs
}

type TemplateInterpolationDenote<Expr extends Type<any>> = Expr extends Param<any, infer Extends> ? Denotes<Extends> : Denotes<Expr>

type CheckTemplateInterpolation<Expr extends Type<any>> =
    IsAny<TemplateInterpolationDenote<Expr>> extends true ? []
  : [TemplateInterpolationDenote<Expr>] extends [TemplateInterpolation] ? []
  : TemplateInterpolationError<TemplateInterpolationDenote<Expr>>

type CheckTemplateInterpolations<Exprs extends Type<any>[]> =
    Exprs extends [infer Head extends Type<any>, ...infer Tail extends Type<any>[]] ?
      CheckTemplateInterpolation<Head> extends [] ? CheckTemplateInterpolations<Tail>
    : CheckTemplateInterpolation<Head>
  : []

export const template = <const Parts extends readonly string[], const Exprs extends Type<any>[]>(
  parts: Parts,
  ...exprs: Exprs & Guard<CheckTemplateInterpolations<Exprs>>
): TemplateLiteralType<Parts, Exprs> => {
  if (parts.length !== exprs.length + 1) {
    throw new Error(`a template literal type with ${exprs.length} exprs needs ${exprs.length + 1} parts, got ${parts.length}`)
  }
  return makeType({ kind: "template-literal", parts, exprs })
}

// type parameters

/** a type parameter, and every later mention of it: `Param("T")` is both the `T` in `<T>` and the `T` in `value: T` */
export interface Param<
  Name extends string,
  Extends extends Type = Type<unknown>,
  A = Variable<Name> & Denotes<Extends>,
> extends Type<A> {
  readonly kind: "param"
  readonly name: Name
  readonly extends?: Extends | undefined
}

export type AnyParam = Param<string, any, any>
export type AnyParams = AnyParam[]

/** rejects a type parameter tuple containing the same name more than once */
export type CheckTypeParamNames<Params extends AnyParams, Seen extends string = never> =
    Params extends [infer Head extends AnyParam, ...infer Tail extends AnyParams] ?
      Head["name"] extends Seen ? ["duplicate type parameter name", Head["name"]]
    : CheckTypeParamNames<Tail, Seen | Head["name"]>
  : []

export const param = <const Name extends string, Extends extends Type = Type<unknown>>(
  name: Name,
  extends_?: Extends,
): Param<Name, Extends> => makeType({ kind: "param", name, extends: extends_ })

// objects

/**
 * A field of an object type together with its modifiers. It is not a type:
 * `readonly` and `?` belong to the field, so only `Object` accepts one, and
 * `Array(Readonly(...))` does not compile.
 */
export interface Field<F extends Type<any> = Type<any>, IsReadonly extends boolean = boolean, IsOptional extends boolean = boolean> {
  readonly type: F
  readonly readonly: IsReadonly
  readonly optional: IsOptional
}

type FieldValue = Type<any> | Field

interface Fields {
  [key: string]: FieldValue
}

type TypeOf<X extends FieldValue> = X extends Field<infer F, any, any> ? F : X
type ReadonlyOf<X extends FieldValue> = X extends Field<any, infer R, any> ? R : false
type OptionalOf<X extends FieldValue> = X extends Field<any, any, infer O> ? O : false

export const isField = (value: FieldValue): value is Field => !isType(value)

/** a field with no modifiers is written as its bare type; this reads either spelling */
export const fieldOf = (value: FieldValue): Field => (isField(value) ? value : { type: value, readonly: false, optional: false })

/** `readonly key: T` */
export const readonly_ = <const X extends FieldValue>(field: X): Field<TypeOf<X>, true, OptionalOf<X>> =>
  ({ ...fieldOf(field), readonly: true }) as Field<TypeOf<X>, true, OptionalOf<X>>

/** `key?: T` */
export const optional = <const X extends FieldValue>(field: X): Field<TypeOf<X>, ReadonlyOf<X>, true> =>
  ({ ...fieldOf(field), optional: true }) as Field<TypeOf<X>, ReadonlyOf<X>, true>

type FieldMods<X extends FieldValue> = `${ReadonlyOf<X> extends true ? "ro" : ""}${OptionalOf<X> extends true ? "opt" : ""}`

type ObjectFields<F extends Fields> =
  & { readonly [K in keyof F as FieldMods<F[K]> extends "roopt" ? K : never]?: Denotes<TypeOf<F[K]>> }
  & { readonly [K in keyof F as FieldMods<F[K]> extends "ro" ? K : never]: Denotes<TypeOf<F[K]>> }
  & { [K in keyof F as FieldMods<F[K]> extends "opt" ? K : never]?: Denotes<TypeOf<F[K]>> }
  & { -readonly [K in keyof F as FieldMods<F[K]> extends "" ? K : never]: Denotes<TypeOf<F[K]>> }

export interface Object<F extends Fields = Fields> extends Type<ObjectFields<F>> {
  readonly kind: "object"
  readonly fields: F
}

export const object = <const F extends Fields>(fields: F): Object<F> => makeType({ kind: "object", fields })

// composites

type UnionMembers = [Type<any>, Type<any>, ...Type<any>[]]

export interface Union<Members extends UnionMembers = UnionMembers> extends Type<Denotes<Members[number]>> {
  readonly kind: "union"
  readonly members: Members
}

export const union = <const Members extends UnionMembers>(...members: Members): Union<Members> => makeType({ kind: "union", members })

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never

export interface Intersection<Members extends UnionMembers = UnionMembers> extends Type<UnionToIntersection<Denotes<Members[number]>>> {
  readonly kind: "intersection"
  readonly members: Members
}

export const intersection = <const Members extends UnionMembers>(...members: Members): Intersection<Members> =>
  makeType({ kind: "intersection", members })

export interface ArrayType<Element extends Type<any> = Type<any>> extends Type<Array<Denotes<Element>>> {
  readonly kind: "array"
  readonly element: Element
}

export const array = <const Element extends Type<any>>(element: Element): ArrayType<Element> => makeType({ kind: "array", element })

export interface TupleType<Items extends Type<any>[] = Type<any>[]> extends Type<ArgTypes<Items>> {
  readonly kind: "tuple"
  readonly items: Items
}

export const tuple = <const Items extends Type<any>[]>(...items: Items): TupleType<Items> => makeType({ kind: "tuple", items })

type CheckRestConstraint<Constraint> =
    IsAny<Constraint> extends true ? ["function rest type must be an array or tuple", Constraint]
  : Constraint extends readonly unknown[] ? []
  : ["function rest type must be an array or tuple", Constraint]

type RestDenotation<Rest extends Type<any>> = Denotes<Rest> extends readonly unknown[] ? Denotes<Rest> : never

type FnParams<Params extends Type<any>[], Rest> = [Rest] extends [Type<any>] ? [...ArgTypes<Params>, ...RestDenotation<Rest>] : ArgTypes<Params>

type CheckFunctionRest<Rest extends Type<any> | undefined> =
    [Rest] extends [Param<any, infer Extends, any>] ? CheckRestConstraint<Denotes<Extends>>
  : [Rest] extends [Type<any>] ?
      IsAny<Denotes<Rest>> extends true ? []
    : Denotes<Rest> extends readonly unknown[] ? []
    : ["function rest type must be an array or tuple", Denotes<Rest>]
  : []

export interface FunctionType<
  Params extends Type<any>[] = Type<any>[],
  Return extends Type<any> = Type<any>,
  Rest extends Type<any> | undefined = Type<any> | undefined,
> extends Type<(...args: FnParams<Params, Rest>) => Denotes<Return>> {
  readonly kind: "function"
  readonly params: Params
  readonly return: Return
  /** the array type of a trailing rest parameter */
  readonly rest?: Rest | undefined
}

export const fn = <
  const Params extends Type<any>[],
  const Return extends Type<any>,
  const Rest extends Type<any> | undefined = undefined,
>(
  params: Params,
  returnType: Return,
  rest?: Rest,
  ..._check: CheckFunctionRest<Rest>
): FunctionType<Params, Return, Rest> => makeType({ kind: "function", params, return: returnType, rest })

// type operators

export interface IndexedAccess<O extends Type<any> = Type<any>, K extends Type<any> = Type<any>> extends Type<IndexDenote<Denotes<O>, Denotes<K>>> {
  readonly kind: "indexed-access"
  readonly object: O
  readonly key: K
}

export const index = <const O extends Type<any>, const K extends Type<any>>(object: O, key: K): IndexedAccess<O, K> =>
  makeType({ kind: "indexed-access", object, key })

export interface KeyOf<T extends Type<any> = Type<any>> extends Type<KeyOfDenote<Denotes<T>>> {
  readonly kind: "keyof"
  readonly operand: T
}

export const keyof_ = <const T extends Type<any>>(operand: T): KeyOf<T> => makeType({ kind: "keyof", operand })

export interface Conditional<
  Check extends Type<any> = Type<any>,
  Pattern extends Type<any> = Type<any>,
  Then extends Type<any> = Type<any>,
  Else extends Type<any> = Type<any>,
> extends Type<CondDenote<Denotes<Check>, Denotes<Pattern>, Denotes<Then>, Denotes<Else>>> {
  readonly kind: "conditional"
  readonly check: Check
  readonly extends: Pattern
  readonly then: Then
  readonly else: Else
}

export interface Logical<Op extends "and" | "or" = "and" | "or", L extends Type<any> = Type<any>, R extends Type<any> = Type<any>>
  extends Type<LogicalDenote<Op, Denotes<L>, Denotes<R>>>
{
  readonly kind: "logical"
  readonly op: Op
  readonly left: L
  readonly right: R
}

export const logical = <const Op extends "and" | "or", const L extends Type<any>, const R extends Type<any>>(
  op: Op,
  left: L,
  right: R,
): Logical<Op, L, R> => makeType({ kind: "logical", op, left, right })

export const conditional = <
  const C extends Type<any>,
  const P extends Type<any>,
  const T extends Type<any>,
  const E extends Type<any>,
>(
  check: C,
  pattern: P,
  then: T,
  else_: E,
): Conditional<C, P, T, E> => makeType({ kind: "conditional", check, extends: pattern, then, else: else_ })

/** `infer Name`, for use inside a conditional's pattern; the then-branch refers to it as `Param(Name)` */
export interface InferVar<Name extends string = string> extends Type<Infer<Name>> {
  readonly kind: "infer-var"
  readonly name: Name
}

export const infer_ = <const Name extends string>(name: Name): InferVar<Name> => makeType({ kind: "infer-var", name })

/** `{ [Key in keyof Source]: Body }`; refer to the key inside `body` with `Param(key)` */
export interface Mapped<K extends string = string, Source extends Type<any> = Type<any>, F extends Type<any> = Type<any>>
  extends Type<MappedDenote<Denotes<Source>, Denotes<F>, K>>
{
  readonly kind: "mapped"
  readonly key: K
  readonly source: Source
  readonly body: F
}

export const mapped = <const K extends string, const Source extends Type<any>, const F extends Type<any>>(
  key: K,
  source: Source,
  body: F,
): Mapped<K, Source, F> => makeType({ kind: "mapped", key, source, body })

// references to named types

/** a reference to the identity of a declared type alias */
export interface TypeRef<A = unknown> extends Type<A>, ValueBinding {
  readonly kind: "type-ref"
  readonly args: Type<any>[]
}

/** applies a declared generic type to arguments; the result is a reference to `callee` with those args */
export const apply = <Callee extends TypeRef<any>, const Args extends Type<any>[]>(
  callee: Callee,
  args: Args,
  ..._check: [Applied<Callee, Args>] extends [ArityError<any, any> | ConstraintError<any, any, any>] ? [Applied<Callee, Args>] : []
): TypeRef<Applied<Callee, Args>> => makeType({ kind: "type-ref", id: callee.id, nameHint: callee.nameHint, args })

type PromiseRef = TypeRef<Fn<[Param<"T">], Generic<"Promise", [Variable<"T">]>>>

/**
 * A host type the program uses but does not declare, such as `Date` or
 * `Promise<A>`. It is named by `name`, and the type argument is all the
 * program knows about it.
 */
export interface External<A = unknown> extends Type<A> {
  readonly kind: "external"
  readonly name: string
  readonly args: Type<any>[]
}

export const external = <A = unknown>(name: string, ...args: Type<any>[]): External<A> => makeType({ kind: "external", name, args })

/** the host `Promise<A>`; like `Array`, but external, because a promise has no structure to spell */
export const promise = <const A extends Type<any>>(value: A): External<Applied<PromiseRef, [A]>> => external("Promise", value)

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
  | Logical
  | Conditional
  | Mapped
  | TypeRef<any>
  | External<any>
