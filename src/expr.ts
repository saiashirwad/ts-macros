import type { BindingId, ValueReference } from "./identity.ts"
import { makeNode, type Pipeable } from "./node.ts"
import * as Type from "./types/index.ts"
import { type BinaryResult, binaryType, lub, type PropResult, propType, type UnaryResult, unaryType, type Widen, widen } from "./types/lattice.ts"

declare const ExprTypeId: unique symbol

/** an expression node; `A` is the TypeScript type of the value it denotes, `type` is that type as data when known */
export interface Expr<A = unknown> extends Pipeable {
  readonly [ExprTypeId]?: A
  readonly type?: Type.TypeExpr<any> | undefined
}

export type Denotes<E extends Expr<any>> = E extends Expr<infer A> ? A : never

/** a reference to a `let`, `const`, param, or loop variable; `Mutable` is phantom and says whether `Assign` accepts it */
export interface VarRef<A = unknown, Mutable extends boolean = true> extends Expr<A>, ValueReference {
  readonly tag: "var-ref"
  readonly target: BindingId
  readonly nameHint: string
  readonly mutable?: Mutable | undefined
  readonly type?: Type.TypeExpr<A> | undefined
}

export const VarRef = <A = unknown, Mutable extends boolean = true>(
  target: BindingId,
  nameHint: string,
  type?: Type.TypeExpr<A>,
): VarRef<A, Mutable> => makeNode({ tag: "var-ref", target, nameHint, type })

/** a host value the program refers to but does not declare; with `source`, an import */
export interface ExternalRef<A = unknown> extends Expr<A> {
  readonly tag: "external-ref"
  readonly name: string
  readonly source?: string | undefined
}

export const ExternalRef = <A = unknown>(name: string, source?: string): ExternalRef<A> => makeNode({ tag: "external-ref", name, source })

type LiteralValue = string | number | boolean

export interface Literal<Value extends LiteralValue> extends Expr<Value> {
  readonly tag: "literal"
  readonly value: Value
  readonly type: Type.Literal<Value>
}

const literal = <const Value extends LiteralValue>(value: Value): Literal<Value> => makeNode({ tag: "literal", value, type: Type.Literal(value) })

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
  return makeNode({ tag: "object", fields, type })
}

export interface Prop<O extends Expr<any>, K extends string & keyof Denotes<O>> extends Expr<PropResult<Denotes<O>, K>> {
  readonly tag: "prop"
  readonly object: O
  readonly key: K
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Prop = <const O extends Expr<any>, const K extends string & keyof Denotes<O>>(object: O, key: K): Prop<O, K> => {
  return makeNode({ tag: "prop", object, key, type: propType(object.type, key) })
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
  return makeNode({ tag: "index", object, index, type })
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
  return makeNode({ tag: "array", elements, type })
}

export type BinaryOperator = "+" | "-" | "*" | "/" | "%" | "===" | "!==" | "<" | "<=" | ">" | ">=" | "&&" | "||"

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
): Binary<Op, L, R> => makeNode({ tag: "binary", op, left, right, type: binaryType(op, left.type, right.type) })

export type UnaryOperator = "!" | "typeof"

export interface Unary<Op extends UnaryOperator, E extends Expr<any>> extends Expr<UnaryResult<Op>> {
  readonly tag: "unary"
  readonly op: Op
  readonly operand: E
  readonly type?: Type.TypeExpr<any> | undefined
}

export const Unary = <const Op extends UnaryOperator, const E extends Expr<any>>(op: Op, operand: E): Unary<Op, E> =>
  makeNode({ tag: "unary", op, operand, type: unaryType(op) })

export interface Template extends Expr<string> {
  readonly tag: "template"
  readonly parts: readonly string[]
  readonly exprs: Expr<any>[]
  readonly type?: Type.TypeExpr<string> | undefined
}

export const Template = <const Parts extends readonly string[]>(parts: Parts, ...exprs: Expr<any>[]): Template => {
  if (parts.length !== exprs.length + 1) {
    throw new Error(`a template with ${exprs.length} exprs needs ${exprs.length + 1} parts, got ${parts.length}`)
  }
  return makeNode({ tag: "template", parts, exprs, type: Type.String() })
}

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
  return makeNode({ tag: "cond", condition, then, else: else_, type })
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
  | Cond<Expr<any>, Expr<any>, Expr<any>>
