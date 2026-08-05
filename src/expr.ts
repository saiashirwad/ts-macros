import { makePipeable, type Pipeable } from "./pipeable.ts"

declare const ExprTypeId: unique symbol

export interface Expr<A = unknown> extends Pipeable {
  readonly [ExprTypeId]?: A
}

export interface VarRef<A = unknown> extends Expr<A> {
  readonly tag: "var-ref"
  readonly name: string
}

type LiteralValue = string | number | boolean

export interface Literal<Value extends LiteralValue> extends Expr<Value> {
  readonly tag: "literal"
  readonly value: Value
}

export interface ExprFields {
  readonly [key: string]: Expr<any>
}

export type ObjectExprShape<Fields extends ExprFields> = {
  readonly [K in keyof Fields]: Fields[K] extends Expr<infer A> ? A : never
}

export interface ObjectExpr<Fields extends ExprFields = ExprFields> extends
  Expr<
    ObjectExprShape<Fields>
  >
{
  readonly tag: "object"
  readonly fields: Fields
}

export const String = <const Value extends string>(value: Value): Literal<Value> =>
  makePipeable({ tag: "literal", value })

export const Number = <const Value extends number>(value: Value): Literal<Value> =>
  makePipeable({ tag: "literal", value })

export const Boolean = <const Value extends boolean>(value: Value): Literal<Value> =>
  makePipeable({ tag: "literal", value })

export const Object = <const Fields extends ExprFields>(fields: Fields): ObjectExpr<Fields> =>
  makePipeable({ tag: "object", fields })

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

// dprint-ignore
type Widen<A> =
    A extends string ? string
  : A extends number ? number
  : A extends boolean ? boolean
  : A

type OperandError<Op extends string, L, R> = ["invalid operands for", Op, L, R]

// dprint-ignore
type ArithmeticResult<Op extends string, L, R> =
    [L] extends [number] ?
      [R] extends [number] ? number
    : OperandError<Op, L, R>
  : OperandError<Op, L, R>

// dprint-ignore
type PlusResult<L, R> =
    [L] extends [string] ? string
  : [R] extends [string] ? string
  : ArithmeticResult<"+", L, R>

// dprint-ignore
type ComparisonResult<Op extends string, L, R> =
    [L] extends [number] ?
      [R] extends [number] ? boolean
    : OperandError<Op, L, R>
  : [L] extends [string] ?
      [R] extends [string] ? boolean
    : OperandError<Op, L, R>
  : OperandError<Op, L, R>

// dprint-ignore
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

// dprint-ignore
export type UnaryResult<Op extends UnaryOperator, _A> =
    Op extends "!" ? boolean
  : Op extends "typeof" ? string
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
