// Typing rules.
//
// Every rule exists twice. As a function over type nodes it is what the
// runtime infers and attaches to `node.type`; as a type over denotations it is
// what the phantoms say in the editor. The two halves of a rule sit next to
// each other here, and tests/typing.test.ts checks that they agree.

import type { BindingDeclaration } from "../binding.ts"
import type * as Expr from "../expr.ts"
import type * as Fn from "../function.ts"
import { makeTypeNode } from "../node.ts"
import type { Block, Statement } from "../statement.ts"
import type { Generic, TypeExpr, Variable } from "./core.ts"
import * as Type from "./index.ts"

type Ty = TypeExpr<any>

// equality

const sameOptional = (a: Ty | undefined, b: Ty | undefined): boolean => a === undefined || b === undefined ? a === b : sameType(a, b)

const sameTypes = (as: readonly Ty[], bs: readonly Ty[]): boolean => as.length === bs.length && as.every((type, index) => sameType(type, bs[index]!))

const sameTypeSet = (as: readonly Ty[], bs: readonly Ty[]): boolean => {
  if (as.length !== bs.length) return false
  const unused = [...bs]
  return as.every((type) => {
    const index = unused.findIndex((seen) => sameType(type, seen))
    if (index === -1) return false
    unused.splice(index, 1)
    return true
  })
}

const sameField = (a: Type.Field, b: Type.Field): boolean => a.readonly === b.readonly && a.optional === b.optional && sameType(a.type, b.type)

/** applies `f` to every field's type, keeping its modifiers */
const mapFields = (node: Type.Object, f: (type: Ty) => Ty): Ty =>
  Type.Object(Object.fromEntries(
    Object.entries(node.fields).map(([key, value]) => [key, Type.isField(value) ? { ...value, type: f(value.type) } : f(value)]),
  ))

/** structural equality of type nodes */
export const sameType = (a: Ty, b: Ty): boolean => {
  const left = a as Type.Any
  const right = b as Type.Any
  if (left.tag !== right.tag) return false
  // the tags agree, so `right` has the shape of `left`
  const other = right as never

  switch (left.tag) {
    case "primitive":
      return left.name === (other as Type.Primitive).name
    case "literal":
      return left.value === (other as Type.Literal).value
    case "template-literal":
      return left.parts.length === (other as Type.TemplateLiteralType).parts.length
        && left.parts.every((part, index) => part === (other as Type.TemplateLiteralType).parts[index])
        && sameTypes(left.exprs, (other as Type.TemplateLiteralType).exprs)
    case "param":
      return left.name === (other as Type.AnyParam).name && sameOptional(left.extends, (other as Type.AnyParam).extends)
    case "infer-var":
      return left.name === (other as Type.InferVar).name
    case "object": {
      const fields = (other as Type.Object).fields
      const keys = Object.keys(left.fields)
      return keys.length === Object.keys(fields).length
        && keys.every((key) => Object.hasOwn(fields, key) && sameField(Type.fieldOf(left.fields[key]!), Type.fieldOf(fields[key]!)))
    }
    case "union":
    case "intersection":
      return sameTypeSet(left.members, (other as Type.Union).members)
    case "array":
      return sameType(left.element, (other as Type.ArrayType).element)
    case "tuple":
      return sameTypes(left.items, (other as Type.TupleType).items)
    case "function":
      return sameTypes(left.params, (other as Type.FunctionType).params)
        && sameType(left.return, (other as Type.FunctionType).return)
        && sameOptional(left.rest, (other as Type.FunctionType).rest)
    case "indexed-access":
      return sameType(left.object, (other as Type.IndexedAccess).object) && sameType(left.key, (other as Type.IndexedAccess).key)
    case "keyof":
      return sameType(left.operand, (other as Type.KeyOf).operand)
    case "conditional":
      return sameType(left.check, (other as Type.Conditional).check)
        && sameType(left.extends, (other as Type.Conditional).extends)
        && sameType(left.then, (other as Type.Conditional).then)
        && sameType(left.else, (other as Type.Conditional).else)
    case "mapped":
      return left.key === (other as Type.Mapped).key
        && sameType(left.source, (other as Type.Mapped).source)
        && sameType(left.body, (other as Type.Mapped).body)
    case "type-ref":
      return left.name === (other as Type.TypeRef).name && sameTypes(left.args, (other as Type.TypeRef).args)
  }
}

// joining and widening

/** least upper bound: the union of the distinct members, or the single member */
export const lub = (types: readonly Ty[]): Ty => {
  const distinct: Ty[] = []
  for (const type of types) {
    if (!distinct.some((seen) => sameType(seen, type))) distinct.push(type)
  }
  return distinct.length === 1 ? distinct[0]! : Type.Union(...distinct as [Ty, Ty, ...Ty[]])
}

const primitiveOf = (value: string | number | boolean): Ty =>
  typeof value === "string" ? Type.String() : typeof value === "number" ? Type.Number() : Type.Boolean()

/** literal types become their primitive, all the way down */
export const widen = (type: Ty): Ty => {
  const node = type as Type.Any
  switch (node.tag) {
    case "literal":
      return node.value === null ? type : primitiveOf(node.value)
    case "object":
      return mapFields(node, widen)
    case "array":
      return Type.Array(widen(node.element))
    case "tuple":
      return Type.Tuple(...node.items.map(widen))
    case "union":
      return lub(node.members.map(widen))
    default:
      return type
  }
}

export type Widen<A> =
    A extends Variable<any> ? A
  : A extends Generic<any, any> ? A
  : A extends string ? string
  : A extends number ? number
  : A extends boolean ? boolean
  : A extends (...args: any[]) => any ? A
  : A extends object ? { [K in keyof A]: Widen<A[K]> }
  : A

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
  const node = expr as Expr.Any | Fn.Any
  switch (node.tag) {
    case "literal":
      return widen(node.type)
    case "object": {
      const fields = Object.entries(node.fields).map(([key, value]) => [key, widenFresh(value)] as const)
      return fields.every(([, type]) => type !== undefined) ? Type.Object(Object.fromEntries(fields.map(([key, type]) => [key, type!]))) : undefined
    }
    case "cond":
      return join(widenFresh(node.then), widenFresh(node.else))
    case "binary":
      return node.op === "&&" || node.op === "||" ? join(widenFresh(node.left), widenFresh(node.right)) : node.type
    case "var-ref":
      return node.fresh && node.type !== undefined ? widen(node.type) : node.type
    default:
      return expr.type
  }
}

export type WidenFresh<E> =
    E extends Expr.Literal<infer V> ? Widen<V>
  : E extends Expr.ObjectExpr<infer F> ? { -readonly [K in keyof F]: WidenFresh<F[K]> }
  : E extends Expr.Cond<any, infer T, infer El> ? WidenFresh<T> | WidenFresh<El>
  : E extends Expr.Binary<"&&" | "||", infer L, infer R> ? WidenFresh<L> | WidenFresh<R>
  : E extends Expr.VarRef<infer A, any, true> ? Widen<A>
  : E extends Expr.Expr<infer A> ? A
  : never

/** the type a `const` infers: like `let`, except that a literal at the top is kept (`const x = 1` is `1`, `const o = { a: 1 }` is `{ a: number }`) */
export const constType = (expr: Expr.Expr<any>): Ty | undefined => {
  const node = expr as Expr.Any | Fn.Any
  switch (node.tag) {
    case "cond":
      return join(constType(node.then), constType(node.else))
    case "binary":
      return node.op === "&&" || node.op === "||" ? join(constType(node.left), constType(node.right)) : node.type
    case "object":
      return widenFresh(expr)
    default:
      return expr.type
  }
}

export type ConstType<E> =
    E extends Expr.Cond<any, infer T, infer El> ? ConstType<T> | ConstType<El>
  : E extends Expr.Binary<"&&" | "||", infer L, infer R> ? ConstType<L> | ConstType<R>
  : E extends Expr.ObjectExpr<any> ? WidenFresh<E>
  : E extends Expr.Expr<infer A> ? A
  : never

/** whether a `const` holding this passes freshness on: `const c = 1; let y = c` makes `y` a number */
export const isFresh = (expr: Expr.Expr<any>): boolean => {
  const node = expr as Expr.Any | Fn.Any
  switch (node.tag) {
    case "literal":
      return true
    case "cond":
      return isFresh(node.then) || isFresh(node.else)
    case "binary":
      return (node.op === "&&" || node.op === "||") && (isFresh(node.left) || isFresh(node.right))
    case "var-ref":
      return node.fresh
    default:
      return false
  }
}

type AnyFresh<E> =
    E extends Expr.Literal<any> ? true
  : E extends Expr.Cond<any, infer T, infer El> ? AnyFresh<T> | AnyFresh<El>
  : E extends Expr.Binary<"&&" | "||", infer L, infer R> ? AnyFresh<L> | AnyFresh<R>
  : E extends Expr.VarRef<any, any, true> ? true
  : false

export type IsFresh<E> = true extends AnyFresh<E> ? true : false

/** the return type a function infers from the expressions it returns: a union of them is kept, a lone fresh literal widens */
export const returnTypeOf = (returns: readonly Expr.Expr<any>[]): Ty | undefined => {
  const kept = returns.map(constType)
  if (!kept.every((type) => type !== undefined)) return undefined
  const joined = lub(kept.map((type) => type!))
  return (joined as Type.Any).tag === "union" ? joined : returns.map(widenFresh).reduce(join)
}

type IsUnion<A, Each = A> = A extends any ? ([Each] extends [A] ? false : true) : never

export type WidenReturn<E> = true extends IsUnion<ConstType<E>> ? ConstType<E> : WidenFresh<E>

// bindings and functions

/** the type a binding takes: its annotation, or else what its initializer infers to */
export const bindingType = (tag: BindingDeclaration["tag"], annotation: Ty | undefined, initializer: Expr.Expr<any> | undefined): Ty | undefined => {
  if (annotation !== undefined) return annotation
  if (initializer === undefined) return undefined
  return tag === "let-declaration" ? widenFresh(initializer) : constType(initializer)
}

/** the return type of a block: void when nothing returns, undefined if any returned value is untyped */
export const blockReturnType = (root: Block): Ty | undefined => {
  const values: Expr.Expr<any>[] = []
  const visit = (statements: ReadonlyArray<Statement>): void => {
    for (const statement of statements) {
      if (statement.tag === "return") {
        values.push(statement.value)
      } else if (statement.tag === "if") {
        statement.clauses.forEach((clause) => visit(clause.body.statements))
        if (statement.else !== undefined) visit(statement.else.statements)
      } else if (statement.tag === "while" || statement.tag === "for-of") {
        visit(statement.body.statements)
      }
    }
  }
  visit(root.statements)
  return values.length === 0 ? Type.Void() : returnTypeOf(values)
}

/** the type of a function with these params, once its return type is known; a rest param is declared by its element type */
export const signatureType = (params: ReadonlyArray<Fn.AnyParam>, returnType: Ty | undefined): Type.FunctionType | undefined => {
  if (returnType === undefined) return undefined
  const rest = params.find((param) => param.kind === "rest")
  return Type.Function(
    params.filter((param) => param.kind !== "rest").map((param) => param.type),
    returnType,
    rest === undefined ? undefined : Type.Array(rest.type),
  )
}

/** the type of a call to `callee`, when its type is a known function type */
export const callType = (callee: Expr.Expr<any>): Ty | undefined => {
  const type = callee.type as Type.Any | undefined
  return type?.tag === "function" ? type.return : undefined
}

// substitution

/** replaces type params by position, rebuilding every node that contains one; the phantom half is `Substitute` in core.ts */
export const substitute = (type: Ty, params: Type.AnyParams, args: Ty[]): Ty => {
  const node = type as Type.Any
  const sub = (child: Ty): Ty => substitute(child, params, args)
  switch (node.tag) {
    case "param": {
      const index = params.findIndex((param) => param.name === node.name)
      return index === -1 ? type : args[index] ?? type
    }
    case "primitive":
    case "literal":
    case "infer-var":
      return type
    case "template-literal":
      return makeTypeNode({ ...node, exprs: node.exprs.map(sub) })
    case "object":
      return mapFields(node, sub)
    case "union":
    case "intersection":
      return makeTypeNode({ ...node, members: node.members.map(sub) })
    case "array":
      return Type.Array(sub(node.element))
    case "tuple":
      return Type.Tuple(...node.items.map(sub))
    case "function":
      return Type.Function(node.params.map(sub), sub(node.return), node.rest === undefined ? undefined : sub(node.rest))
    case "indexed-access":
      return Type.Index(sub(node.object), sub(node.key))
    case "keyof":
      return Type.KeyOf(sub(node.operand))
    case "conditional":
      return Type.Conditional(sub(node.check), sub(node.extends), sub(node.then), sub(node.else))
    case "mapped":
      // the mapped type's own key shadows any param of the same name inside its body
      return Type.Mapped(node.key, sub(node.source), substitute(node.body, params.filter((param) => param.name !== node.key), args))
    case "type-ref":
      return makeTypeNode({ ...node, args: node.args.map(sub) })
  }
}

// operators

const isPrimitive = (type: Ty, name: Type.PrimitiveName): boolean => {
  const node = widen(type) as Type.Any
  return node.tag === "primitive" && node.name === name
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
      return Type.Boolean()
  }

  if (left === undefined || right === undefined) return undefined

  switch (op) {
    case "&&":
    case "||":
      return lub([left, right])
    case "+":
      if (isPrimitive(left, "string") || isPrimitive(right, "string")) return Type.String()
      return isPrimitive(left, "number") && isPrimitive(right, "number") ? Type.Number() : undefined
    case "-":
    case "*":
    case "/":
    case "%":
      return isPrimitive(left, "number") && isPrimitive(right, "number") ? Type.Number() : undefined
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
  : Op extends "&&" | "||" ? L | R
  : never

/** the `..._check` of a binary operator: empty when the operands admit it */
export type CheckOperands<Op extends Expr.BinaryOperator, L, R> = [BinaryResult<Op, L, R>] extends [OperandError<string, any, any>]
  ? [BinaryResult<Op, L, R>]
  : []

const TYPEOF_RESULTS = ["string", "number", "bigint", "boolean", "symbol", "undefined", "object", "function"] as const

/** the type of `op operand` */
export const unaryType = (op: Expr.UnaryOperator): Ty =>
  op === "!" ? Type.Boolean() : Type.Union(...TYPEOF_RESULTS.map((name) => Type.Literal(name)) as [Type.Literal, Type.Literal, ...Type.Literal[]])

export type UnaryResult<Op extends Expr.UnaryOperator> =
    Op extends "!" ? boolean
  : Op extends "typeof" ? (typeof TYPEOF_RESULTS)[number]
  : never

// member access

/** the type of `object.key` when `object` is a known object type; reading an optional field may give undefined */
export const propType = (object: Ty | undefined, key: string): Ty | undefined => {
  const node = object as Type.Any | undefined
  const value = node?.tag === "object" ? node.fields[key] : undefined
  if (value === undefined) return undefined
  const field = Type.fieldOf(value)
  return field.optional ? lub([field.type, Type.Undefined()]) : field.type
}

export type PropResult<O, K extends keyof O> = {} extends Pick<O, K> ? O[K] | undefined : O[K]

// iteration

/** the type a `for (const x of iterable)` variable takes */
export const elementType = (iterable: Ty | undefined): Ty | undefined => {
  const node = iterable as Type.Any | undefined
  if (node?.tag === "array") return node.element
  if (node !== undefined && isPrimitive(node, "string")) return Type.String()
  return undefined
}

export type ElementOf<A> =
    A extends readonly (infer E)[] ? E
  : A extends string ? string
  : never
