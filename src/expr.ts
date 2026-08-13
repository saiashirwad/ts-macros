import { makePipeable, makeYieldable, type Pipeable, type Yieldable } from "./pipeable.ts"
import type { Generic, Variable } from "./types/core.ts"

declare const ExprTypeId: unique symbol

export interface Expr<A = unknown> extends Pipeable {
  readonly [ExprTypeId]?: A
}

export interface VarRef<A = unknown, Mutable extends boolean = true> extends Expr<A> {
  readonly tag: "var-ref"
  readonly name: string
  readonly mutable?: Mutable
  /** provenance for module-bound refs; the emitter hoists these into imports */
  readonly source?: string
}

type LiteralValue = string | number | boolean

export interface Literal<Value extends LiteralValue> extends Expr<Value> {
  readonly tag: "literal"
  readonly value: Value
}

export interface ExprFields {
  readonly [key: string]: Expr<any>
}

export type ObjectExprShape<F extends ExprFields> = {
  -readonly [K in keyof F]: F[K] extends Expr<infer A> ? A : never
}

export interface ObjectExpr<F extends ExprFields = ExprFields> extends Expr<ObjectExprShape<F>> {
  readonly tag: "object"
  readonly fields: F
}

export const String = <const Value extends string>(value: Value): Literal<Value> => makePipeable({ tag: "literal", value })

export const Number = <const Value extends number>(value: Value): Literal<Value> => makePipeable({ tag: "literal", value })

export const Boolean = <const Value extends boolean>(value: Value): Literal<Value> => makePipeable({ tag: "literal", value })

export const Object = <const F extends ExprFields>(fields: F): ObjectExpr<F> => makePipeable({ tag: "object", fields })

export type Denotes<E extends Expr<any>> = E extends Expr<infer A> ? A : never

export interface Prop<O extends Expr<any>, K extends string & keyof Denotes<O>> extends
  Expr<
    Denotes<O>[K]
  >
{
  readonly tag: "prop"
  readonly object: O
  readonly key: K
}

export const Prop = <const O extends Expr<any>, const K extends string & keyof Denotes<O>>(
  object: O,
  key: K,
): Prop<O, K> => makePipeable({ tag: "prop", object, key })

export interface Index<O extends Expr<readonly unknown[]>, I extends Expr<number>> extends
  Expr<
    Denotes<O>[number]
  >
{
  readonly tag: "index"
  readonly object: O
  readonly index: I
}

export const Index = <const O extends Expr<readonly unknown[]>, const I extends Expr<number>>(
  object: O,
  index: I,
): Index<O, I> => makePipeable({ tag: "index", object, index })

export interface ArrayExpr<Elements extends Expr<any>[]> extends Expr<Denotes<Elements[number]>[]> {
  readonly tag: "array"
  readonly elements: Elements
}

export const Array = <const Elements extends Expr<any>[]>(
  ...elements: Elements
): ArrayExpr<Elements> => makePipeable({ tag: "array", elements })

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "==="
  | "!=="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||"

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

export type ConstWiden<A> =
    A extends Variable<any> ? A
  : A extends Generic<any, any> ? A
  : A extends string | number | boolean ? A
  : A extends (...args: any[]) => any ? A
  : A extends object ? { [K in keyof A]: Widen<A[K]> }
  : A

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
  : Op extends "-" | "*" | "/" ? ArithmeticResult<Op, Widen<L>, Widen<R>>
  : Op extends "===" | "!==" ? boolean
  : Op extends "<" | "<=" | ">" | ">=" ? ComparisonResult<Op, Widen<L>, Widen<R>>
  : Op extends "&&" | "||" ? L | R
  : never

export interface Binary<
  Op extends BinaryOperator,
  L extends Expr<any>,
  R extends Expr<any>,
> extends Expr<BinaryResult<Op, Denotes<L>, Denotes<R>>> {
  readonly tag: "binary"
  readonly op: Op
  readonly left: L
  readonly right: R
}

export const Binary = <
  const Op extends BinaryOperator,
  const L extends Expr<any>,
  const R extends Expr<any>,
>(
  op: Op,
  left: L,
  right: R,
): Binary<Op, L, R> => makePipeable({ tag: "binary", op, left, right })

export type UnaryOperator = "!" | "typeof"

export type UnaryResult<Op extends UnaryOperator, _A> =
    Op extends "!" ? boolean
  : Op extends "typeof" ? "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function"
  : never

export interface Unary<Op extends UnaryOperator, E extends Expr<any>> extends
  Expr<
    UnaryResult<Op, Denotes<E>>
  >
{
  readonly tag: "unary"
  readonly op: Op
  readonly operand: E
}

export const Unary = <const Op extends UnaryOperator, const E extends Expr<any>>(
  op: Op,
  operand: E,
): Unary<Op, E> => makePipeable({ tag: "unary", op, operand })

export interface Template extends Expr<string> {
  readonly tag: "template"
  readonly parts: readonly string[]
  readonly exprs: Expr<any>[]
}

export const Template = <const Parts extends readonly string[]>(
  parts: Parts,
  ...exprs: Expr<any>[]
): Template => makePipeable({ tag: "template", parts, exprs })

export type LValue =
  | VarRef<any, true>
  | (Expr<any> & { readonly tag: "prop" })
  | (Expr<any> & { readonly tag: "index" })

type IsReadonly<O, K extends keyof O> = (<U>() => U extends { [P in K]: O[P] } ? 1 : 2) extends <U>() => U extends { readonly [P in K]: O[P] } ? 1 : 2
  ? true
  : false

export type IsWritableTarget<T> = T extends Prop<infer O, infer K> ? (IsReadonly<Denotes<O>, K> extends true ? false : true) : true

export interface Assign<T extends LValue, V extends Expr<Denotes<T>>> extends Expr<Denotes<T>>, Yieldable {
  readonly tag: "assign"
  readonly target: T
  readonly value: V
}

export const Assign = <const T extends LValue, const V extends Expr<Denotes<T>>>(
  target: T,
  value: V,
  ..._check: IsWritableTarget<T> extends false ? ["cannot assign to a readonly prop"] : []
): Assign<T, V> => makeYieldable({ tag: "assign", target, value })

export interface Cond<C extends Expr<any>, T extends Expr<any>, E extends Expr<any>> extends
  Expr<
    Denotes<T> | Denotes<E>
  >
{
  readonly tag: "cond"
  readonly condition: C
  readonly then: T
  readonly else: E
}

export const Cond = <const C extends Expr<boolean>, const T extends Expr<any>, const E extends Expr<any>>(
  condition: C,
  then: T,
  else_: E,
): Cond<C, T, E> => makePipeable({ tag: "cond", condition, then, else: else_ })

/** every expr node kind, instantiated so the emitter can switch exhaustively */
export type Any =
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
