import { makeTypeNode } from "../pipeable.ts"
import type { Applied, ArgTypes, Denotes, TypeExpr } from "./core.ts"

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

// composites

interface Fields {
  [key: string]: TypeExpr<any>
}

export interface ReadonlyField<F extends TypeExpr<any> = TypeExpr<any>> extends TypeExpr<Denotes<F>> {
  readonly tag: "readonly-field"
  readonly field: F
}

/** marks an object field readonly; only meaningful inside `Object` */
export const Readonly = <const F extends TypeExpr<any>>(field: F): ReadonlyField<F> => makeTypeNode({ tag: "readonly-field", field })

type ObjectFields<F extends Fields> =
  & { readonly [K in keyof F as F[K] extends ReadonlyField<any> ? K : never]: Denotes<F[K]> }
  & { -readonly [K in keyof F as F[K] extends ReadonlyField<any> ? never : K]: Denotes<F[K]> }

export interface Object<F extends Fields = Fields> extends TypeExpr<ObjectFields<F>> {
  readonly tag: "object"
  readonly fields: F
}

export const Object = <const F extends Fields>(fields: F): Object<F> => makeTypeNode({ tag: "object", fields })

type UnionMembers = [TypeExpr<any>, TypeExpr<any>, ...TypeExpr<any>[]]

export interface Union<Members extends UnionMembers = UnionMembers> extends TypeExpr<Denotes<Members[number]>> {
  readonly tag: "union"
  readonly members: Members
}

export const Union = <const Members extends UnionMembers>(...members: Members): Union<Members> => makeTypeNode({ tag: "union", members })

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

export interface FunctionType<
  Params extends TypeExpr<any>[] = TypeExpr<any>[],
  Return extends TypeExpr<any> = TypeExpr<any>,
> extends TypeExpr<(...args: ArgTypes<Params>) => Denotes<Return>> {
  readonly tag: "function"
  readonly params: Params
  readonly return: Return
}

export const Function = <const Params extends TypeExpr<any>[], const Return extends TypeExpr<any>>(
  params: Params,
  returnType: Return,
): FunctionType<Params, Return> => makeTypeNode({ tag: "function", params, return: returnType })

// references to named types

export interface TypeRef<A = unknown> extends TypeExpr<A> {
  readonly tag: "type-ref"
  readonly name: string
  readonly args?: TypeExpr<any>[] | undefined
  /** for nominal types: the structural type an emitter that does not know the name may spell instead */
  readonly erasesTo?: TypeExpr<any> | undefined
}

export const Ref = <A = unknown>(name: string, ...args: TypeExpr<any>[]): TypeRef<A> =>
  makeTypeNode(args.length > 0 ? { tag: "type-ref", name, args } : { tag: "type-ref", name })

export const Nominal = <A = unknown>(name: string, erasesTo: TypeExpr<A>, ...args: TypeExpr<any>[]): TypeRef<A> =>
  makeTypeNode(args.length > 0 ? { tag: "type-ref", name, args, erasesTo } : { tag: "type-ref", name, erasesTo })

/** applies a declared generic type to arguments; the result is a reference to `callee` with those args */
export const Apply = <Callee extends TypeRef<any>, const Args extends TypeExpr<any>[]>(
  callee: Callee,
  args: Args,
): TypeRef<Applied<Callee, Args>> => makeTypeNode({ tag: "type-ref", name: callee.name, args })
