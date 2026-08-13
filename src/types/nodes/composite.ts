import { makePipeable } from "../../pipeable.ts"
import type { ArgTypes, Denotes, TypeExpr } from "../core.ts"
import type { CondDenote, IndexDenote, KeyOfDenote, MappedDenote, TmplDenote } from "../machinery.ts"

interface Fields {
  [key: string]: TypeExpr<any>
}

export interface ReadonlyField<F extends TypeExpr<any> = TypeExpr<any>> extends TypeExpr<Denotes<F>> {
  readonly tag: "readonly-field"
  readonly field: F
}

export const Readonly = <const F extends TypeExpr<any>>(field: F): ReadonlyField<F> => makePipeable({ tag: "readonly-field", field })

export interface OptionalField<F extends TypeExpr<any> = TypeExpr<any>> extends TypeExpr<Denotes<F>> {
  readonly tag: "optional-field"
  readonly field: F
}

export const Optional = <const F extends TypeExpr<any>>(field: F): OptionalField<F> => makePipeable({ tag: "optional-field", field })

type FieldMods<F> =
    F extends ReadonlyField<OptionalField<any>> ? "ro&opt"
  : F extends OptionalField<ReadonlyField<any>> ? "ro&opt"
  : F extends ReadonlyField<any> ? "ro"
  : F extends OptionalField<any> ? "opt"
  : "plain"

type ObjectShape<F extends Fields> =
  & { readonly [K in keyof F as FieldMods<F[K]> extends "ro&opt" ? K : never]?: Denotes<F[K]> }
  & { readonly [K in keyof F as FieldMods<F[K]> extends "ro" ? K : never]: Denotes<F[K]> }
  & { [K in keyof F as FieldMods<F[K]> extends "opt" ? K : never]?: Denotes<F[K]> }
  & { -readonly [K in keyof F as FieldMods<F[K]> extends "plain" ? K : never]: Denotes<F[K]> }

export interface Object<F extends Fields = Fields> extends TypeExpr<ObjectShape<F>> {
  readonly tag: "object"
  readonly fields: F
}

type UnionMembers = [TypeExpr<any>, TypeExpr<any>, ...TypeExpr<any>[]]

type UnionShape<Members extends TypeExpr<any>[]> = Members[number] extends TypeExpr<infer A> ? A : never

export interface Union<Members extends UnionMembers> extends TypeExpr<UnionShape<Members>> {
  readonly tag: "union"
  readonly members: Members
}

export interface ArrayType<Element extends TypeExpr<any> = TypeExpr<any>> extends
  TypeExpr<
    Array<Denotes<Element>>
  >
{
  readonly tag: "array"
  readonly element: Element
}

export interface TupleType<Items extends TypeExpr<any>[] = TypeExpr<any>[]> extends
  TypeExpr<
    ArgTypes<Items>
  >
{
  readonly tag: "tuple"
  readonly items: Items
}

type FnParams<Params extends TypeExpr<any>[], Rest> =
    [Rest] extends [TypeExpr<any>] ? [...ArgTypes<Params>, ...(Denotes<Rest> & readonly unknown[])]
  : ArgTypes<Params>

export interface FunctionType<
  Params extends TypeExpr<any>[] = TypeExpr<any>[],
  Return extends TypeExpr<any> = TypeExpr<any>,
  Rest extends TypeExpr<any> | undefined = undefined,
> extends TypeExpr<(...args: FnParams<Params, Rest>) => Denotes<Return>> {
  readonly tag: "function"
  readonly params: Params
  readonly return: Return
  readonly rest?: Rest
}

export const Object = <const F extends Fields>(fields: F): Object<F> => makePipeable({ tag: "object", fields })

export const Union = <const Members extends UnionMembers>(...members: Members): Union<Members> => makePipeable({ tag: "union", members })

export const Array = <const Element extends TypeExpr<any>>(element: Element): ArrayType<Element> => makePipeable({ tag: "array", element })

export const Tuple = <const Items extends TypeExpr<any>[]>(...items: Items): TupleType<Items> => makePipeable({ tag: "tuple", items })

export const Function = <const Params extends TypeExpr<any>[], const Return extends TypeExpr<any>, const Rest extends TypeExpr<any> | undefined = undefined>(
  params: Params,
  returnType: Return,
  rest?: Rest,
): FunctionType<Params, Return, Rest> =>
  makePipeable({ tag: "function", params, return: returnType, ...(rest === undefined ? {} : { rest }) }) as FunctionType<Params, Return, Rest>

type UnionToIntersection<U> = (U extends any ? (x: U) => void : never) extends (x: infer I) => void ? I : never

type IntersectionShape<Members extends TypeExpr<any>[]> = UnionToIntersection<Members[number] extends TypeExpr<infer A> ? A : never>

export interface Intersection<Members extends TypeExpr<any>[] = TypeExpr<any>[]> extends TypeExpr<IntersectionShape<Members>> {
  readonly tag: "intersection"
  readonly members: Members
}

export const Intersection = <const Members extends [TypeExpr<any>, TypeExpr<any>, ...TypeExpr<any>[]]>(
  ...members: Members
): Intersection<Members> => makePipeable({ tag: "intersection", members })

export interface IndexedAccess<O extends TypeExpr<any> = TypeExpr<any>, K extends TypeExpr<any> = TypeExpr<any>> extends
  TypeExpr<
    IndexDenote<Denotes<O>, Denotes<K>>
  >
{
  readonly tag: "indexed-access"
  readonly object: O
  readonly key: K
}

export const Index = <const O extends TypeExpr<any>, const K extends TypeExpr<any>>(object: O, key: K): IndexedAccess<O, K> =>
  makePipeable({ tag: "indexed-access", object, key })

export interface KeyOf<T extends TypeExpr<any> = TypeExpr<any>> extends
  TypeExpr<
    KeyOfDenote<Denotes<T>>
  >
{
  readonly tag: "keyof"
  readonly operand: T
}

export const KeyOf = <const T extends TypeExpr<any>>(operand: T): KeyOf<T> => makePipeable({ tag: "keyof", operand })

export interface Conditional<
  Check extends TypeExpr<any> = TypeExpr<any>,
  Pattern extends TypeExpr<any> = TypeExpr<any>,
  Then extends TypeExpr<any> = TypeExpr<any>,
  Else extends TypeExpr<any> = TypeExpr<any>,
> extends
  TypeExpr<
    CondDenote<Denotes<Check>, Denotes<Pattern>, Denotes<Then>, Denotes<Else>>
  >
{
  readonly tag: "conditional"
  readonly check: Check
  readonly extends: Pattern
  readonly then: Then
  readonly else: Else
}

export const Conditional = <const C extends TypeExpr<any>, const P extends TypeExpr<any>, const T extends TypeExpr<any>, const E extends TypeExpr<any>>(
  check: C,
  pattern: P,
  then: T,
  else_: E,
): Conditional<C, P, T, E> => makePipeable({ tag: "conditional", check, extends: pattern, then, else: else_ })

export interface Mapped<
  K extends string = string,
  Source extends TypeExpr<any> = TypeExpr<any>,
  F extends TypeExpr<any> = TypeExpr<any>,
> extends
  TypeExpr<
    MappedDenote<Denotes<Source>, Denotes<F>, K>
  >
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
): Mapped<K, Source, F> => makePipeable({ tag: "mapped", key, source, body })

export interface TemplateLiteralType<
  Parts extends readonly string[] = readonly string[],
  Exprs extends TypeExpr<any>[] = TypeExpr<any>[],
> extends
  TypeExpr<
    TmplDenote<Parts, ArgTypes<Exprs>>
  >
{
  readonly tag: "template-literal"
  readonly parts: Parts
  readonly exprs: Exprs
}

export const TemplateLiteral = <const Parts extends readonly string[], const Exprs extends TypeExpr<any>[]>(
  parts: Parts,
  ...exprs: Exprs
): TemplateLiteralType<Parts, Exprs> => makePipeable({ tag: "template-literal", parts, exprs })

/** an infer binding inside a conditional pattern — used by the extractor combinators */
export interface InferVar<Name extends string = string> extends TypeExpr<any> {
  readonly tag: "infer-var"
  readonly name: Name
}

export const InferVar = <const Name extends string>(name: Name): InferVar<Name> => makePipeable({ tag: "infer-var", name })
