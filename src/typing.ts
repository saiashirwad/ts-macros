// Typing rules.
//
// Every rule exists twice. As a function over type nodes it is what the
// runtime infers and attaches to `node.type`; as a type over denotations it is
// what the phantoms say in the editor. The two halves of a rule sit next to
// each other here, and tests/typing.test.ts checks that they agree.

import type { Block } from "./block.ts"
import type { BindingDeclaration } from "./declaration.ts"
import type * as Expr from "./expr.ts"
import { type AnyParam, type ParamForm, validateParamNames } from "./expr.ts"
import { logicalType, lub, type Widen, widen } from "./types/algebra.ts"
import * as Type from "./types/index.ts"
import { children, type ValueNode } from "./walk.ts"

type Ty = Type.Type<any>

// freshness
//
// TypeScript widens a literal type only while it is fresh: while it is the
// type of a literal expression, or of something built straight from one.
// `let n = 1` is a number, but `let first = xs[0]` keeps `"a" | "b"` when that
// is what `xs` was declared to hold. So what a declaration infers is a rule
// about the initializer expression, not about its type.

const join = (a: Ty | undefined, b: Ty | undefined): Ty | undefined => (a === undefined || b === undefined ? undefined : lub([a, b]))

/** the type a `let` infers from its initializer: what is fresh widens, anything else is kept */
export const widenFresh = (expr: Expr.Expr<any>): Ty | undefined => {
  const node = expr as Expr.Any
  switch (node.kind) {
    case "literal":
      return widen(node.type)
    case "cond":
      return join(widenFresh(node.then), widenFresh(node.else))
    case "binary": {
      if (node.op !== "&&" && node.op !== "||") return node.type
      const left = node.left.type
      const right = node.right.type
      const widenedRight = widenFresh(node.right)
      return left === undefined || right === undefined || widenedRight === undefined
        ? undefined
        : logicalType(node.op, left, right, isFresh(node.left), widenedRight)
    }
    case "ref":
      return node.fresh && node.type !== undefined ? widen(node.type) : node.type
    default:
      return expr.type
  }
}

export type WidenFresh<E> =
    E extends Expr.Literal<infer V> ? Widen<V>
  : E extends Expr.Cond<any, infer T, infer El> ? WidenFresh<T> | WidenFresh<El>
  : E extends Expr.Binary<infer Op extends "&&" | "||", infer L, infer R> ? WidenLogical<Op, L, R>
  : E extends Expr.Ref<infer A, any, true> ? Widen<A>
  : E extends Expr.Expr<infer A> ? A
  : never

type WidenLogical<Op extends "&&" | "||", L extends Expr.Expr<any>, R extends Expr.Expr<any>> =
    unknown extends Expr.Denotes<L> ? LogicalResult<Op, Expr.Denotes<L>, Expr.Denotes<R>>
  : Type.Abstract<Expr.Denotes<L> | Expr.Denotes<R>> extends true ? LogicalResult<Op, Expr.Denotes<L>, Expr.Denotes<R>>
  : 
    | (IsFresh<L> extends true ? Widen<LogicalResult<Op, Expr.Denotes<L>, never>> : LogicalResult<Op, Expr.Denotes<L>, never>)
    | ((Op extends "&&" ? Type.HasTruthy<Expr.Denotes<L>> : Type.HasFalsy<Expr.Denotes<L>>) extends true ? WidenFresh<R> : never)

/** the type a `const` infers: like `let`, except that a literal at the top is kept (`const x = 1` is `1`, `const o = { a: 1 }` is `{ a: number }`) */
export const constType = (expr: Expr.Expr<any>): Ty | undefined => {
  const node = expr as Expr.Any
  switch (node.kind) {
    case "cond":
      return join(constType(node.then), constType(node.else))
    case "binary": {
      if (node.op !== "&&" && node.op !== "||") return node.type
      const left = constType(node.left)
      const right = constType(node.right)
      return left === undefined || right === undefined ? undefined : logicalType(node.op, left, right)
    }
    default:
      return expr.type
  }
}

export type ConstType<E> =
    E extends Expr.Cond<any, infer T, infer El> ? ConstType<T> | ConstType<El>
  : E extends Expr.Binary<infer Op extends "&&" | "||", infer L, infer R> ? LogicalResult<Op, ConstType<L>, ConstType<R>>
  : E extends Expr.Expr<infer A> ? A
  : never

/** whether a `const` holding this passes freshness on: `const c = 1; let y = c` makes `y` a number */
export const isFresh = (expr: Expr.Expr<any>): boolean => {
  const node = expr as Expr.Any
  switch (node.kind) {
    case "literal":
      return true
    case "cond":
      return isFresh(node.then) || isFresh(node.else)
    case "binary":
      return (node.op === "&&" || node.op === "||") && (isFresh(node.left) || isFresh(node.right))
    case "ref":
      return node.fresh
    default:
      return false
  }
}

type AnyFresh<E> =
    E extends Expr.Literal<any> ? true
  : E extends Expr.Cond<any, infer T, infer El> ? AnyFresh<T> | AnyFresh<El>
  : E extends Expr.Binary<"&&" | "||", infer L, infer R> ? AnyFresh<L> | AnyFresh<R>
  : E extends Expr.Ref<any, any, true> ? true
  : false

export type IsFresh<E> = true extends AnyFresh<E> ? true : false

/** the return type a function infers from the expressions it returns: a union of them is kept, a lone fresh literal widens */
export const returnTypeOf = (returns: readonly Expr.Expr<any>[]): Ty | undefined => {
  const expand = (expr: Expr.Expr<any>): Expr.Expr<any>[] => {
    const node = expr as Expr.Any
    return node.kind === "cond" ? [...expand(node.then), ...expand(node.else)] : [expr]
  }
  const values = returns.flatMap(expand)
  const kept = values.map(constType)
  if (!kept.every((type) => type !== undefined)) return undefined
  const keys = new Set(
    kept.flatMap((type, index) =>
      values[index]!.kind === "object" && (type as Type.Any).kind === "object" ? Object.keys((type as Type.Object).fields) : []
    ),
  )
  const normalized = kept.map((type, index) => {
    const node = type as Type.Any
    if (values[index]!.kind !== "object" || node.kind !== "object") return type!
    return Type.object({
      ...Object.fromEntries([...keys].filter((key) => !(key in node.fields)).map((key) => [key, Type.optional(Type.never)])),
      ...node.fields,
    })
  })
  const joined = lub(normalized)
  return (joined as Type.Any).kind === "union" ? joined : values.map(widenFresh).reduce(join)
}

type IsUnion<A, Each = A> = A extends any ? ([Each] extends [A] ? false : true) : never

type ReturnNodes<E> = E extends Expr.Cond<any, infer T, infer El> ? ReturnNodes<T> | ReturnNodes<El> : E
type ReturnKeys<E> = E extends Expr.ObjectExpr<any> ? keyof Expr.Denotes<E> : never
type Simplify<A> = { [K in keyof A]: A[K] }
type NormalizedReturn<E, Keys extends PropertyKey = ReturnKeys<E>> = E extends Expr.ObjectExpr<any>
  ? Simplify<Expr.Denotes<E> & { [K in Exclude<Keys, keyof Expr.Denotes<E>>]?: never }>
  : ConstType<E>

export type WidenReturn<E> = true extends IsUnion<ConstType<ReturnNodes<E>>> ? NormalizedReturn<ReturnNodes<E>> : WidenFresh<E>

// bindings and functions

/** the value type a parameter binding has inside its implementation */
export type ParamBindingType<A, Kind extends ParamForm> =
    Kind extends "rest" ? A[]
  : Kind extends "optional" ? A | undefined
  : A

export const paramBindingType = (param: AnyParam): Ty => {
  switch (param.form) {
    case "required":
      return param.type
    case "optional":
      return Type.union(param.type, Type.undefined_)
    case "rest":
      return Type.array(param.type)
  }
}

/** the type a binding takes: its annotation, or else what its initializer infers to */
export const bindingType = (
  kind: BindingDeclaration["kind"],
  annotation: Ty | undefined,
  initializer: Expr.Expr<any> | undefined,
): Ty | undefined => {
  if (annotation !== undefined) return annotation
  if (initializer === undefined) return undefined
  return kind === "let-declaration" ? widenFresh(initializer) : constType(initializer)
}

/** the return type of a block: void when nothing returns, undefined if any returned value is untyped */
export const blockReturnType = (root: Block): Ty | undefined => {
  const values: Expr.Expr<any>[] = []
  const visit = (node: ValueNode): void => {
    if (node.kind === "return") values.push(node.value)
    // a nested function's returns are its own
    else if (node.kind !== "arrow" && node.kind !== "function-declaration") children(node).forEach(visit)
  }
  visit(root)
  return values.length === 0 ? Type.void_ : returnTypeOf(values)
}

/** the type of a function with these params, once its return type is known; a rest param is declared by its element type */
export const signatureType = (params: ReadonlyArray<AnyParam>, returnType: Ty | undefined): Type.FunctionType | undefined => {
  validateParamNames(params)
  if (returnType === undefined) return undefined
  const rest = params.find((param) => param.form === "rest")
  return Type.fn(
    params.filter((param) => param.form !== "rest").map((param) => param.type),
    returnType,
    rest === undefined ? undefined : Type.array(rest.type),
  )
}

/** the type of a call to `callee`, when its type is a known function type */
export const callType = (callee: Expr.Expr<any>): Ty | undefined => {
  const type = callee.type as Type.Any | undefined
  return type?.kind === "function" ? type.return : undefined
}

type LogicalResult<Op extends "&&" | "||", L, R> = Type.LogicalDenote<Op extends "&&" ? "and" : "or", L, R>

const isPrimitive = (type: Ty, name: Type.PrimitiveName): boolean => {
  const node = widen(type) as Type.Any
  return node.kind === "primitive" && node.name === name
}

/** the type of `left op right`, or undefined when the operands do not admit the operator */
export const binaryType = (op: Expr.BinaryOperator, left: Ty | undefined, right: Ty | undefined): Ty | undefined => {
  switch (op) {
    // a comparison is a boolean whatever is known about its operands
    case "===":
    case "!==":
    case "<":
    case "<=":
    case ">":
    case ">=":
      return Type.boolean
  }

  if (left === undefined || right === undefined) return undefined

  switch (op) {
    case "&&":
    case "||":
      return logicalType(op, left, right)
    case "+":
      if (isPrimitive(left, "symbol") || isPrimitive(right, "symbol")) return undefined
      if (isPrimitive(left, "string") || isPrimitive(right, "string")) return Type.string
      if (isPrimitive(left, "bigint") && isPrimitive(right, "bigint")) return Type.bigint
      return isPrimitive(left, "number") && isPrimitive(right, "number") ? Type.number : undefined
    case "-":
    case "*":
    case "/":
    case "%":
      if (isPrimitive(left, "bigint") && isPrimitive(right, "bigint")) return Type.bigint
      return isPrimitive(left, "number") && isPrimitive(right, "number") ? Type.number : undefined
  }
}

type OperandError<Op extends string, L, R> = ["invalid operands for", Op, L, R]

type ArithmeticResult<Op extends string, L, R> =
    [L] extends [number] ?
      [R] extends [number] ? number
    : OperandError<Op, L, R>
  : OperandError<Op, L, R>

type PlusResult<L, R> =
    [Extract<L | R, symbol>] extends [never] ?
      [L] extends [string] ? string
    : [R] extends [string] ? string
    : NumericResult<"+", L, R>
  : OperandError<"+", L, R>

type NumericResult<Op extends string, L, R> =
    [L] extends [bigint] ?
      [R] extends [bigint] ? bigint
    : OperandError<Op, L, R>
  : ArithmeticResult<Op, L, R>

type ComparisonResult<Op extends string, L, R> =
    [L] extends [number | bigint] ?
      [R] extends [number | bigint] ? boolean
    : OperandError<Op, L, R>
  : [L] extends [string] ?
      [R] extends [string] ? boolean
    : OperandError<Op, L, R>
  : OperandError<Op, L, R>

export type BinaryResult<Op extends Expr.BinaryOperator, L, R> =
    Op extends "+" ? PlusResult<Widen<L>, Widen<R>>
  : Op extends "-" | "*" | "/" | "%" ? NumericResult<Op, Widen<L>, Widen<R>>
  : Op extends "===" | "!==" ? EqualityResult<Op, L, R>
  : Op extends "<" | "<=" | ">" | ">=" ? ComparisonResult<Op, Widen<L>, Widen<R>>
  : Op extends "&&" | "||" ? LogicalResult<Op, L, R>
  : never

type EqualityResult<Op extends string, L, R> =
    [L] extends [null | undefined] ? boolean
  : [R] extends [null | undefined] ? boolean
  : [Extract<L, R> | Extract<R, L>] extends [never] ? OperandError<Op, L, R>
  : boolean

/** the `..._check` of a binary operator: empty when the operands admit it */
export type CheckOperands<Op extends Expr.BinaryOperator, L, R> = [BinaryResult<Op, L, R>] extends [OperandError<string, any, any>]
  ? [BinaryResult<Op, L, R>]
  : []

const TYPEOF_RESULTS = ["string", "number", "bigint", "boolean", "symbol", "undefined", "object", "function"] as const

/** the type of `op operand` */
export const unaryType = (op: Expr.UnaryOperator): Ty =>
  op === "!" ? Type.boolean : Type.union(...TYPEOF_RESULTS.map((name) => Type.literal(name)) as [Type.Literal, Type.Literal, ...Type.Literal[]])

export type UnaryResult<Op extends Expr.UnaryOperator> =
    Op extends "!" ? boolean
  : Op extends "typeof" ? (typeof TYPEOF_RESULTS)[number]
  : never

// member access

/** the type of `object.key` when `object` is a known object type; reading an optional field may give undefined */
export const propType = (object: Ty | undefined, key: string): Ty | undefined => {
  const node = object as Type.Any | undefined
  const value = node?.kind === "object" ? node.fields[key] : undefined
  if (value === undefined) return undefined
  const field = Type.fieldOf(value)
  return field.optional ? lub([field.type, Type.undefined_]) : field.type
}

export type PropResult<O, K extends keyof O> = {} extends Pick<O, K> ? O[K] | undefined : O[K]

// iteration

/** the type a `for (const x of iterable)` variable takes */
export const elementType = (iterable: Ty | undefined): Ty | undefined => {
  const node = iterable as Type.Any | undefined
  if (node?.kind === "array") return node.element
  if (node !== undefined && isPrimitive(node, "string")) return Type.string
  return undefined
}

export type ElementOf<A> =
    A extends readonly (infer E)[] ? E
  : A extends string ? string
  : never
