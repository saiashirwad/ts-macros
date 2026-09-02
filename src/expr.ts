import type { BindingId, ValueReference } from "./identity.ts"
import { makePipeable, makeYieldable, type Pipeable, type Yieldable } from "./pipeable.ts"
import type { Generic, Variable } from "./types/core.ts"
import * as Type from "./types/index.ts"
import { binaryType, lub, widen } from "./types/lattice.ts"

declare const ExprTypeId: unique symbol

/** an expression node; `A` is the TypeScript type of the value it denotes, `type` is that type as data when known */
export interface Expr<A = unknown> extends Pipeable {
  readonly [ExprTypeId]?: A
  readonly type?: Type.TypeExpr<any> | undefined
}

export type Denotes<E extends Expr<any>> = E extends Expr<infer A> ? A : never

export interface VarRef<A = unknown, Mutable extends boolean = true> extends Expr<A>, ValueReference {
  readonly tag: "var-ref"
  readonly target: BindingId
  readonly nameHint: string
  readonly mutable?: Mutable | undefined
  readonly type?: Type.TypeExpr<A> | undefined
}

export const LocalRef = <A = unknown, Mutable extends boolean = true>(
  target: BindingId,
  nameHint: string,
  type?: Type.TypeExpr<A>,
): VarRef<A, Mutable> => makePipeable({ tag: "var-ref", target, nameHint, type })

/** a host value the program refers to but does not declare; with `source`, an import */
export interface ExternalRef<A = unknown> extends Expr<A> {
  readonly tag: "external-ref"
  readonly name: string
  readonly source?: string | undefined
  readonly type?: Type.TypeExpr<A> | undefined
}

type LiteralValue = string | number | boolean

export interface Literal<Value extends LiteralValue> extends Expr<Value> {
  readonly tag: "literal"
  readonly value: Value
  readonly type: Type.Literal<Value>
}

const literal = <const Value extends LiteralValue>(value: Value): Literal<Value> => makePipeable({ tag: "literal", value, type: Type.Literal(value) })

export const String = <const Value extends string>(value: Value): Literal<Value> => literal(value)
export const Number = <const Value extends number>(value: Value): Literal<Value> => literal(value)
export const Boolean = <const Value extends boolean>(value: Value): Literal<Value> => literal(value)

export interface ExprFields {
  readonly [key: string]: Expr<any>
}

export type ObjectExprFields<F extends ExprFields> = {
  -readonly [K in keyof F]: F[K] extends Expr<infer A> ? A : never
}

export interface ObjectExpr<F extends ExprFields = ExprFields> extends Expr<ObjectExprFields<F>> {
  readonly tag: "object"
  readonly fields: F
  readonly type?: Type.Object | undefined
}

export const Object = <const F extends ExprFields>(fields: F): ObjectExpr<F> => {
  const entries = globalThis.Object.entries(fields)
  const type = entries.every(([, value]) => value.type !== undefined)
    ? Type.Object(globalThis.Object.fromEntries(entries.map(([key, value]) => [key, value.type!])))
    : undefined
  return makePipeable({ tag: "object", fields, type })
}

export interface Prop<O extends Expr<any>, K extends string & keyof Denotes<O>> extends Expr<Denotes<O>[K]> {
  readonly tag: "prop"
  readonly object: O
  readonly key: K
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Prop = <const O extends Expr<any>, const K extends string & keyof Denotes<O>>(object: O, key: K): Prop<O, K> => {
  const objectType = object.type as Type.Any | undefined
  const type = objectType?.tag === "object" ? objectType.fields[key] : undefined
  return makePipeable({ tag: "prop", object, key, type })
}

export interface Index<O extends Expr<readonly unknown[]>, I extends Expr<number>> extends Expr<Denotes<O>[number]> {
  readonly tag: "index"
  readonly object: O
  readonly index: I
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Index = <const O extends Expr<readonly unknown[]>, const I extends Expr<number>>(object: O, index: I): Index<O, I> => {
  const objectType = object.type as Type.Any | undefined
  const type = objectType?.tag === "array" ? objectType.element : undefined
  return makePipeable({ tag: "index", object, index, type })
}

export interface ArrayExpr<Elements extends Expr<any>[]> extends Expr<Widen<Denotes<Elements[number]>>[]> {
  readonly tag: "array"
  readonly elements: Elements
  readonly type?: Type.ArrayType<any> | undefined
}

export const Array = <const Elements extends Expr<any>[]>(...elements: Elements): ArrayExpr<Elements> => {
  const elementTypes = elements.map((element) => element.type)
  const type = elementTypes.length > 0 && elementTypes.every((element) => element !== undefined)
    ? Type.Array(lub(elementTypes.map((element) => widen(element!))))
    : undefined
  return makePipeable({ tag: "array", elements, type })
}

export type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "&&" | "||"

/** what `let x = value` does to the type of `value`: literals become their primitive, recursively */
export type Widen<A> = A extends Variable<any> ? A
  // TODO: since Generic's phantom props are optional, A extends Generic<any, any> can match plain objects too
  // so this guard needs care. figure this out
  : A extends Generic<any, any> ? A
  : A extends string ? string
  : A extends number ? number
  : A extends boolean ? boolean
  : A extends (...args: any[]) => any ? A
  : A extends object ? { [K in keyof A]: Widen<A[K]> }
  : A

/** what `const x = value` does: the top-level literal is kept, nested ones widen */
export type ConstWiden<A> = A extends string | number | boolean ? A : Widen<A>

type IsUnion<A, Each = A> = A extends any ? ([Each] extends [A] ? false : true) : never

type WidenObjects<A> = A extends object ? Widen<A> : A

/** what TypeScript infers for a function's return: a single literal widens, a union of them is kept, objects widen */
export type WidenReturn<A> = true extends IsUnion<A> ? WidenObjects<A> : Widen<A>

type OperandError<Op extends string, L, R> = ["invalid operands for", Op, L, R]

type ArithmeticResult<Op extends string, L, R> =
    [L] extends [number] ?
      [R] extends [number] ? number
    : OperandError<Op, L, R>
  : OperandError<Op, L, R>

type PlusResult<L, R> =
    [L] extends [string] ? string
  : [R] extends [string] ? string
  : ArithmeticResult<"+", L, R>

type ComparisonResult<Op extends string, L, R> =
    [L] extends [number] ?
      [R] extends [number] ? boolean
    : OperandError<Op, L, R>
  : [L] extends [string] ?
      [R] extends [string] ? boolean
    : OperandError<Op, L, R>
  : OperandError<Op, L, R>

export type BinaryResult<Op extends BinaryOperator, L, R> =
    Op extends "+" ? PlusResult<Widen<L>, Widen<R>>
  : Op extends "-" | "*" | "/" | "%" ? ArithmeticResult<Op, Widen<L>, Widen<R>>
  : Op extends "===" | "!==" ? boolean
  : Op extends "<" | "<=" | ">" | ">=" ? ComparisonResult<Op, Widen<L>, Widen<R>>
  : Op extends "&&" | "||" ? L | R
  : never

export interface Binary<Op extends BinaryOperator, L extends Expr<any>, R extends Expr<any>> extends Expr<BinaryResult<Op, Denotes<L>, Denotes<R>>> {
  readonly tag: "binary"
  readonly op: Op
  readonly left: L
  readonly right: R
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Binary = <const Op extends BinaryOperator, const L extends Expr<any>, const R extends Expr<any>>(
  op: Op,
  left: L,
  right: R,
): Binary<Op, L, R> => makePipeable({ tag: "binary", op, left, right, type: binaryType(op, left.type, right.type) })

export type UnaryOperator = "!" | "typeof"

const TYPEOF_RESULTS = ["string", "number", "bigint", "boolean", "symbol", "undefined", "object", "function"] as const

export type UnaryResult<Op extends UnaryOperator, _A> =
    Op extends "!" ? boolean
  : Op extends "typeof" ? (typeof TYPEOF_RESULTS)[number]
  : never

export interface Unary<Op extends UnaryOperator, E extends Expr<any>> extends Expr<UnaryResult<Op, Denotes<E>>> {
  readonly tag: "unary"
  readonly op: Op
  readonly operand: E
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Unary = <const Op extends UnaryOperator, const E extends Expr<any>>(op: Op, operand: E): Unary<Op, E> =>
  makePipeable({
    tag: "unary",
    op,
    operand,
    type: op === "!"
      ? Type.Boolean()
      : Type.Union(...TYPEOF_RESULTS.map((name) => Type.Literal(name)) as [Type.Literal, Type.Literal, ...Type.Literal[]]),
  })

export interface Template extends Expr<string> {
  readonly tag: "template"
  readonly parts: readonly string[]
  readonly exprs: Expr<any>[]
  readonly type?: Type.TypeExpr<string> | undefined
}

export const Template = <const Parts extends readonly string[]>(parts: Parts, ...exprs: Expr<any>[]): Template =>
  makePipeable({ tag: "template", parts, exprs, type: Type.String() })

export type LValue =
  | VarRef<any, true>
  | (Expr<any> & { readonly tag: "prop" })
  | (Expr<any> & { readonly tag: "index" })

type IsReadonly<O, K extends keyof O> = (<U>() => U extends { [P in K]: O[P] } ? 1 : 2) extends <U>() => U extends { readonly [P in K]: O[P] } ? 1 : 2
  ? true
  : false

export type IsWritableTarget<T> = T extends Prop<infer O, infer K> ? (IsReadonly<Denotes<O>, K> extends true ? false : true) : true

/** an assignment is both an expression and a statement */
export interface Assign<T extends LValue, V extends Expr<Denotes<T>>> extends Expr<Denotes<T>>, Yieldable {
  readonly tag: "assign"
  readonly target: T
  readonly value: V
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Assign = <const T extends LValue, const V extends Expr<Denotes<T>>>(
  target: T,
  value: V,
  ..._check: IsWritableTarget<T> extends false ? ["cannot assign to a readonly prop"] : []
): Assign<T, V> => makeYieldable({ tag: "assign", target, value, type: (target as Expr<any>).type ?? value.type })

export interface Cond<C extends Expr<any>, T extends Expr<any>, E extends Expr<any>> extends Expr<Denotes<T> | Denotes<E>> {
  readonly tag: "cond"
  readonly condition: C
  readonly then: T
  readonly else: E
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Cond = <const C extends Expr<boolean>, const T extends Expr<any>, const E extends Expr<any>>(
  condition: C,
  then: T,
  else_: E,
): Cond<C, T, E> => {
  const type = then.type !== undefined && else_.type !== undefined ? lub([then.type, else_.type]) : undefined
  return makePipeable({ tag: "cond", condition, then, else: else_, type })
}

/** every expression node kind defined here; function-related kinds are `Fn.Any` */
export type Any =
  | ExternalRef<any>
  | Literal<LiteralValue>
  | VarRef<any, any>
  | Prop<Expr<any>, string>
  | Index<Expr<readonly unknown[]>, Expr<number>>
  | ObjectExpr
  | ArrayExpr<any>
  | Binary<BinaryOperator, Expr<any>, Expr<any>>
  | Unary<UnaryOperator, Expr<any>>
  | Template
  | Assign<any, any>
  | Cond<Expr<any>, Expr<any>, Expr<any>>
