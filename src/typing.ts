// Typing rules.
//
// Every rule exists twice. As a function over type nodes it is what the
// runtime infers and attaches to `node.type`; as a type over denotations it is
// what the phantoms say in the editor. The two halves of a rule sit next to
// each other here, and tests/typing.test.ts checks that they agree.

import type { Block } from "./block.ts"
import type { BindingDeclaration } from "./declaration.ts"
import type * as Expr from "./expr.ts"
import type { AnyParam, ParamForm } from "./expr.ts"
import type { Statement } from "./statement.ts"
import { logicalType, lub, type Widen, widen } from "./types/algebra.ts"
import * as Type from "./types/index.ts"

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
    case "object": {
      const fields = Object.entries(node.fields).map(([key, value]) => [key, widenFresh(value)] as const)
      return fields.every(([, type]) => type !== undefined) ? Type.object(Object.fromEntries(fields.map(([key, type]) => [key, type!]))) : undefined
    }
    case "cond":
      return join(widenFresh(node.then), widenFresh(node.else))
    case "binary": {
      if (node.op !== "&&" && node.op !== "||") return node.type
      const left = widenFresh(node.left)
      const right = widenFresh(node.right)
      return left === undefined || right === undefined ? undefined : logicalType(node.op, left, right)
    }
    case "ref":
      return node.fresh && node.type !== undefined ? widen(node.type) : node.type
    default:
      return expr.type
  }
}

export type WidenFresh<E> =
    E extends Expr.Literal<infer V> ? Widen<V>
  : E extends Expr.ObjectExpr<infer F> ? { -readonly [K in keyof F]: WidenFresh<F[K]> }
  : E extends Expr.Cond<any, infer T, infer El> ? WidenFresh<T> | WidenFresh<El>
  : E extends Expr.Binary<infer Op extends "&&" | "||", infer L, infer R> ? LogicalResult<Op, WidenFresh<L>, WidenFresh<R>>
  : E extends Expr.Ref<infer A, any, true> ? Widen<A>
  : E extends Expr.Expr<infer A> ? A
  : never

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
    case "object":
      return widenFresh(expr)
    default:
      return expr.type
  }
}

export type ConstType<E> =
    E extends Expr.Cond<any, infer T, infer El> ? ConstType<T> | ConstType<El>
  : E extends Expr.Binary<infer Op extends "&&" | "||", infer L, infer R> ? LogicalResult<Op, ConstType<L>, ConstType<R>>
  : E extends Expr.ObjectExpr<any> ? WidenFresh<E>
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
  const kept = returns.map(constType)
  if (!kept.every((type) => type !== undefined)) return undefined
  const joined = lub(kept.map((type) => type!))
  return (joined as Type.Any).kind === "union" ? joined : returns.map(widenFresh).reduce(join)
}

type IsUnion<A, Each = A> = A extends any ? ([Each] extends [A] ? false : true) : never

export type WidenReturn<E> = true extends IsUnion<ConstType<E>> ? ConstType<E> : WidenFresh<E>

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
  const visit = (statements: ReadonlyArray<Statement>): void => {
    for (const statement of statements) {
      if (statement.kind === "return") {
        values.push(statement.value)
      } else if (statement.kind === "if") {
        statement.clauses.forEach((clause) => visit(clause.body.statements))
        if (statement.else !== undefined) visit(statement.else.statements)
      } else if (statement.kind === "while" || statement.kind === "for-of") {
        visit(statement.body.statements)
      }
    }
  }
  visit(root.statements)
  return values.length === 0 ? Type.void_ : returnTypeOf(values)
}

/** the type of a function with these params, once its return type is known; a rest param is declared by its element type */
export const signatureType = (params: ReadonlyArray<AnyParam>, returnType: Ty | undefined): Type.FunctionType | undefined => {
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
      if (isPrimitive(left, "string") || isPrimitive(right, "string")) return Type.string
      return isPrimitive(left, "number") && isPrimitive(right, "number") ? Type.number : undefined
    case "-":
    case "*":
    case "/":
    case "%":
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

export type BinaryResult<Op extends Expr.BinaryOperator, L, R> =
    Op extends "+" ? PlusResult<Widen<L>, Widen<R>>
  : Op extends "-" | "*" | "/" | "%" ? ArithmeticResult<Op, Widen<L>, Widen<R>>
  : Op extends "===" | "!==" ? boolean
  : Op extends "<" | "<=" | ">" | ">=" ? ComparisonResult<Op, Widen<L>, Widen<R>>
  : Op extends "&&" | "||" ? LogicalResult<Op, L, R>
  : never

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
