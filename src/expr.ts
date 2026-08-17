import type { BindingId, ValueReference } from "./identity.ts"
import { makePipeable, makeYieldable, type Pipeable, type Yieldable } from "./pipeable.ts"
import type { ExpressionScopeHandlers } from "./scope/protocol.ts"
import type { Generic, Variable } from "./types/core.ts"
import * as Type from "./types/index.ts"

declare const ExprTypeId: unique symbol

export interface Expr<A = unknown> extends Pipeable {
  readonly [ExprTypeId]?: A
  readonly type?: Type.TypeExpr<any> | undefined
}

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
): VarRef<A, Mutable> =>
  makePipeable({
    tag: "var-ref",
    target,
    nameHint,
    type,
  })

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

export const String = <const Value extends string>(value: Value): Literal<Value> => makePipeable({ tag: "literal", value, type: Type.Literal(value) })

export const Number = <const Value extends number>(value: Value): Literal<Value> => makePipeable({ tag: "literal", value, type: Type.Literal(value) })

export const Boolean = <const Value extends boolean>(value: Value): Literal<Value> =>
  makePipeable({ tag: "literal", value, type: Type.Literal(value) })

export const Object = <const F extends ExprFields>(fields: F): ObjectExpr<F> => {
  const fieldTypes: Record<string, Type.TypeExpr<any>> = {}
  let hasAll = true
  for (const [k, v] of globalThis.Object.entries(fields)) {
    if (v.type !== undefined) {
      fieldTypes[k] = v.type
    } else {
      hasAll = false
      break
    }
  }
  return makePipeable({
    tag: "object",
    fields,
    type: hasAll ? Type.Object(fieldTypes) : undefined,
  })
}

export type Denotes<E extends Expr<any>> = E extends Expr<infer A> ? A : never

export interface Prop<O extends Expr<any>, K extends string & keyof Denotes<O>> extends
  Expr<
    Denotes<O>[K]
  >
{
  readonly tag: "prop"
  readonly object: O
  readonly key: K
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Prop = <const O extends Expr<any>, const K extends string & keyof Denotes<O>>(
  object: O,
  key: K,
): Prop<O, K> => {
  const objType = object.type as Type.Object | undefined
  const type = objType?.tag === "object" ? objType.fields[key] : undefined
  return makePipeable({
    tag: "prop",
    object,
    key,
    type,
  })
}

export interface Index<O extends Expr<readonly unknown[]>, I extends Expr<number>> extends
  Expr<
    Denotes<O>[number]
  >
{
  readonly tag: "index"
  readonly object: O
  readonly index: I
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Index = <const O extends Expr<readonly unknown[]>, const I extends Expr<number>>(
  object: O,
  index: I,
): Index<O, I> => {
  const objType = object.type as Type.ArrayType<any> | undefined
  const type = objType?.tag === "array" ? objType.element : undefined
  return makePipeable({
    tag: "index",
    object,
    index,
    type,
  })
}

export interface ArrayExpr<Elements extends Expr<any>[]> extends Expr<Denotes<Elements[number]>[]> {
  readonly tag: "array"
  readonly elements: Elements
  readonly type?: Type.ArrayType<any> | undefined
}

export const Array = <const Elements extends Expr<any>[]>(
  ...elements: Elements
): ArrayExpr<Elements> => {
  const firstType = elements[0]?.type as Type.Any | undefined
  const type = firstType !== undefined
    ? Type.Array(
      firstType.tag === "literal" && firstType.value !== null
        ? typeof firstType.value === "string" ? Type.String() : typeof firstType.value === "number" ? Type.Number() : Type.Boolean()
        : firstType,
    )
    : undefined

  return makePipeable({
    tag: "array",
    elements,
    type,
  })
}

export type BinaryOperator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
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
  : Op extends "-" | "*" | "/" | "%" ? ArithmeticResult<Op, Widen<L>, Widen<R>>
  : Op extends "===" | "!==" ? boolean
  : Op extends "<" | "<=" | ">" | ">=" ? ComparisonResult<Op, Widen<L>, Widen<R>>
  : Op extends "&&" | "||" ? L | R
  : never

const binaryType = (op: BinaryOperator, left: Expr<any>, right: Expr<any>): Type.TypeExpr<any> | undefined => {
  switch (op) {
    case "===":
    case "!==":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return Type.Boolean()
    case "&&":
    case "||":
      return left.type ?? right.type
    case "+": {
      const lt = left.type as Type.Any | undefined
      const rt = right.type as Type.Any | undefined
      if (lt === undefined || rt === undefined) return undefined
      if ((lt.tag === "primitive" && lt.name === "string") || (lt.tag === "literal" && typeof lt.value === "string")) {
        return Type.String()
      }
      if ((rt.tag === "primitive" && rt.name === "string") || (rt.tag === "literal" && typeof rt.value === "string")) {
        return Type.String()
      }
      if (lt.tag === "type-ref" && rt.tag === "type-ref" && lt.name === rt.name) {
        return lt
      }
      return Type.Number()
    }
    case "-":
    case "*":
    case "/":
    case "%": {
      const lt = left.type as Type.Any | undefined
      const rt = right.type as Type.Any | undefined
      if (lt === undefined || rt === undefined) return undefined
      if (lt.tag === "type-ref" && rt.tag === "type-ref" && lt.name === rt.name) {
        return lt
      }
      return Type.Number()
    }
    default:
      return undefined
  }
}

export interface Binary<
  Op extends BinaryOperator,
  L extends Expr<any>,
  R extends Expr<any>,
> extends Expr<BinaryResult<Op, Denotes<L>, Denotes<R>>> {
  readonly tag: "binary"
  readonly op: Op
  readonly left: L
  readonly right: R
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Binary = <
  const Op extends BinaryOperator,
  const L extends Expr<any>,
  const R extends Expr<any>,
>(
  op: Op,
  left: L,
  right: R,
): Binary<Op, L, R> => {
  const type = binaryType(op, left, right)
  return makePipeable({
    tag: "binary",
    op,
    left,
    right,
    type,
  })
}

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
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Unary = <const Op extends UnaryOperator, const E extends Expr<any>>(
  op: Op,
  operand: E,
): Unary<Op, E> =>
  makePipeable({
    tag: "unary",
    op,
    operand,
    type: op === "!" ? Type.Boolean() : Type.String(),
  })

export interface Template extends Expr<string> {
  readonly tag: "template"
  readonly parts: readonly string[]
  readonly exprs: Expr<any>[]
  readonly type?: Type.TypeExpr<string> | undefined
}

export const Template = <const Parts extends readonly string[]>(
  parts: Parts,
  ...exprs: Expr<any>[]
): Template => makePipeable({ tag: "template", parts, exprs, type: Type.String() })

export type LValue =
  | VarRef<any, true>
  | (Expr<any> & { readonly tag: "prop" })
  | (Expr<any> & { readonly tag: "index" })

type IsReadonly<O, K extends keyof O> = (<U>() => U extends { [P in K]: O[P] } ? 1 : 2) extends <U>() => U extends { readonly [P in K]: O[P] } ? 1 : 2
  ? true
  : false

type IsWritableTarget<T> = T extends Prop<infer O, infer K> ? (IsReadonly<Denotes<O>, K> extends true ? false : true) : true

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
): Assign<T, V> => {
  const type = (target as Expr<any>).type ?? value.type
  return makeYieldable({
    tag: "assign",
    target,
    value,
    type,
  })
}

export interface Cond<C extends Expr<any>, T extends Expr<any>, E extends Expr<any>> extends
  Expr<
    Denotes<T> | Denotes<E>
  >
{
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
  let type: Type.TypeExpr<any> | undefined = undefined
  const tt = then.type as Type.Any | undefined
  const et = else_.type as Type.Any | undefined
  if (tt?.tag === "type-ref" && et?.tag === "type-ref" && tt.name === et.name) {
    type = tt
  } else if (tt !== undefined && et !== undefined) {
    const tw = (tt.tag === "literal" && tt.value !== null
      ? typeof tt.value === "string" ? Type.String() : typeof tt.value === "number" ? Type.Number() : Type.Boolean()
      : tt) as Type.Any
    const ew = (et.tag === "literal" && et.value !== null
      ? typeof et.value === "string" ? Type.String() : typeof et.value === "number" ? Type.Number() : Type.Boolean()
      : et) as Type.Any
    if (tw.tag === "primitive" && ew.tag === "primitive" && tw.name === ew.name) {
      type = tw
    } else {
      type = then.type ?? else_.type
    }
  } else {
    type = then.type ?? else_.type
  }
  // oxlint-disable unicorn(no-thenable)
  const node: Cond<C, T, E> = makePipeable({
    tag: "cond",
    condition,
    then,
    else: else_,
    type,
  })
  // oxlint-enable unicorn(no-thenable)
  return node
}

/** every expr node kind, instantiated so the emitter can switch exhaustively */
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

export const expressionScopeHandlers = {
  literal: () => {},
  "external-ref": () => {},
  "var-ref": (node, cursor) => cursor.reference(node),
  prop: (node, cursor) => cursor.expression(node.object),
  index: (node, cursor) => {
    cursor.expression(node.object)
    cursor.expression(node.index)
  },
  object: (node, cursor) => {
    globalThis.Object.values(node.fields).forEach((field) => cursor.expression(field))
  },
  array: (node, cursor) => {
    node.elements.forEach((element: Expr<any>) => cursor.expression(element))
  },
  binary: (node, cursor) => {
    cursor.expression(node.left)
    cursor.expression(node.right)
  },
  unary: (node, cursor) => cursor.expression(node.operand),
  template: (node, cursor) => {
    node.exprs.forEach((part) => cursor.expression(part))
  },
  assign: (node, cursor) => {
    cursor.expression(node.target)
    cursor.expression(node.value)
  },
  cond: (node, cursor) => {
    cursor.expression(node.condition)
    cursor.expression(node.then)
    cursor.expression(node.else)
  },
} satisfies ExpressionScopeHandlers<Any>
