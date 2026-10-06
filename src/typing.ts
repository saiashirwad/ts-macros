import type { Block } from "./block.ts"
import type { BindingDeclaration } from "./declaration.ts"
import type * as Expr from "./expr.ts"
import type { AnyParam, ParamForm } from "./expr.ts"
import { makeNode, type Node } from "./node.ts"
import { isPrimitive, logicalChoices, logicalType, lub, substitute, type Widen, widen } from "./types/algebra.ts"
import * as Type from "./types/index.ts"
import { children, type ValueNode } from "./walk.ts"

type Ty = Type.Type<any>

const unionNodes = (expr: Expr.Expr<any>): Expr.Expr<any>[] => {
  const node = expr as Expr.Any
  return node.kind === "cond" ? [...unionNodes(node.then), ...unionNodes(node.else)] : [expr]
}

export const expressionUnion = (expressions: readonly Expr.Expr<any>[], infer: (expr: Expr.Expr<any>) => Ty | undefined): Ty | undefined => {
  const values = expressions.flatMap(unionNodes)
  const types = values.map(infer)
  if (!types.every((type) => type !== undefined)) return undefined
  const keys = new Set(
    types.flatMap((type, index) =>
      values[index]!.kind === "object" && (type as Type.Any).kind === "object" ? Object.keys((type as Type.Object).fields) : []
    ),
  )
  return lub(types.map((type, index) => {
    const node = type as Type.Any
    if (values[index]!.kind !== "object" || node.kind !== "object") return type!
    return Type.object({
      ...Object.fromEntries([...keys].filter((key) => !(key in node.fields)).map((key) => [key, Type.optional(Type.never)])),
      ...node.fields,
    })
  }))
}

export const widenFresh = (expr: Expr.Expr<any>): Ty | undefined => {
  const node = expr as Expr.Any
  switch (node.kind) {
    case "literal":
      return widen(node.type)
    case "cond":
      return expressionUnion([node.then, node.else], widenFresh)
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

type WidenEach<E> =
    E extends Expr.Literal<infer V> ? Widen<V>
  : E extends Expr.Binary<infer Op extends "&&" | "||", infer L, infer R> ? WidenLogical<Op, L, R>
  : E extends Expr.Ref<infer A, any, true> ? Widen<A>
  : E extends Expr.Expr<infer A> ? A
  : never

export type WidenFresh<E> = NormalizedUnion<UnionNodes<E>, true>

type WidenLogical<Op extends "&&" | "||", L extends Expr.Expr<any>, R extends Expr.Expr<any>> =
    unknown extends Expr.Denotes<L> ? LogicalResult<Op, Expr.Denotes<L>, Expr.Denotes<R>>
  : Type.Abstract<Expr.Denotes<L> | Expr.Denotes<R>> extends true ? LogicalResult<Op, Expr.Denotes<L>, Expr.Denotes<R>>
  : 
    | (IsFresh<L> extends true ? Widen<LogicalResult<Op, Expr.Denotes<L>, never>> : LogicalResult<Op, Expr.Denotes<L>, never>)
    | ((Op extends "&&" ? Type.HasTruthy<Expr.Denotes<L>> : Type.HasFalsy<Expr.Denotes<L>>) extends true ? WidenFresh<R> : never)

export const constType = (expr: Expr.Expr<any>): Ty | undefined => {
  const node = expr as Expr.Any
  switch (node.kind) {
    case "cond":
      return expressionUnion([node.then, node.else], constType)
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

type ConstEach<E> =
    E extends Expr.Binary<infer Op extends "&&" | "||", infer L, infer R> ? LogicalResult<Op, ConstType<L>, ConstType<R>>
  : E extends Expr.Expr<infer A> ? A
  : never

export type ConstType<E> = NormalizedUnion<UnionNodes<E>, false>

export const isFresh = (expr: Expr.Expr<any>): boolean => {
  const node = expr as Expr.Any
  switch (node.kind) {
    case "literal":
      return true
    case "cond":
      return isFresh(node.then) || isFresh(node.else)
    case "binary": {
      if (node.op !== "&&" && node.op !== "||") return false
      if (node.left.type === undefined) return false
      const choices = logicalChoices(node.op, node.left.type)
      return (choices.left.length > 0 && isFresh(node.left)) || (choices.right && isFresh(node.right))
    }
    case "ref":
      return node.fresh
    default:
      return false
  }
}

type AnyFresh<E> =
    E extends Expr.Literal<any> ? true
  : E extends Expr.Cond<any, infer T, infer El> ? AnyFresh<T> | AnyFresh<El>
  : E extends Expr.Binary<infer Op extends "&&" | "||", infer L, infer R> ? 
    | ((Op extends "&&" ? Type.HasFalsy<Expr.Denotes<L>> : Type.HasTruthy<Expr.Denotes<L>>) extends true ? AnyFresh<L> : false)
    | ((Op extends "&&" ? Type.HasTruthy<Expr.Denotes<L>> : Type.HasFalsy<Expr.Denotes<L>>) extends true ? AnyFresh<R> : false)
  : E extends Expr.Ref<any, any, true> ? true
  : false

export type IsFresh<E> = true extends AnyFresh<E> ? true : false

export const returnTypeOf = (returns: readonly Expr.Expr<any>[]): Ty | undefined => {
  const joined = expressionUnion(returns, constType)
  if (joined === undefined) return undefined
  return (joined as Type.Any).kind === "union" ? joined : expressionUnion(returns, widenFresh)
}

type UnionNodes<E> = E extends Expr.Cond<any, infer T, infer El> ? UnionNodes<T> | UnionNodes<El> : E
type ReturnKeys<E> = E extends Expr.ObjectExpr<any> ? keyof Expr.Denotes<E> : never
type Simplify<A> = { [K in keyof A]: A[K] }
type NormalizedUnion<E, Wide extends boolean, Keys extends PropertyKey = ReturnKeys<E>> =
    E extends Expr.ObjectExpr<any> ?
      [Exclude<Keys, keyof Expr.Denotes<E>>] extends [never] ? Expr.Denotes<E>
    : Simplify<Expr.Denotes<E> & { [K in Exclude<Keys, keyof Expr.Denotes<E>>]?: never }>
  : Wide extends true ? WidenEach<E>
  : ConstEach<E>

export type WidenReturn<E> =
    ConstType<E> extends infer C ?
      true extends Type.IsUnion<C> ? C
    : WidenFresh<E>
  : never

export type ParamBindingType<A, Kind extends ParamForm> =
    Kind extends "rest" ? A[]
  : Kind extends "optional" ? A | undefined
  : A

export const paramBindingType = (param: AnyParam): Ty => {
  switch (param.form) {
    case "required":
      return param.type
    case "optional":
      return Type.union(param.type, Type.undefined)
    case "rest":
      return Type.array(param.type)
  }
}

export const bindingType = (
  kind: BindingDeclaration["kind"],
  annotation: Ty | undefined,
  initializer: Expr.Expr<any> | undefined,
): Ty | undefined => {
  if (annotation !== undefined) return annotation
  if (initializer === undefined) return undefined
  return kind === "let-declaration" ? widenFresh(initializer) : constType(initializer)
}

export const blockReturnType = (root: Block): Ty | undefined => {
  const values: Expr.Expr<any>[] = []
  const visit = (node: ValueNode): void => {
    if (node.kind === "return") values.push(node.value)
    else if (node.kind !== "arrow" && node.kind !== "function-declaration") children(node).forEach(visit)
  }
  visit(root)
  return values.length === 0 ? Type.void : returnTypeOf(values)
}

export const signatureType = (params: ReadonlyArray<AnyParam>, returnType: Ty | undefined): Type.FunctionType | undefined => {
  if (returnType === undefined) return undefined
  const rest = params.find((param) => param.form === "rest")
  return Type.fn(
    params.filter((param) => param.form !== "rest").map((param) => param.type),
    returnType,
    rest === undefined ? undefined : Type.array(rest.type),
  )
}

export const callType = (callee: Expr.Expr<any>): Ty | undefined => {
  const type = callee.type as Type.Any | undefined
  return type?.kind === "function" ? type.return : undefined
}

type LogicalResult<Op extends "&&" | "||", L, R> = Type.LogicalDenote<Op extends "&&" ? "and" : "or", L, R>

const widensTo = (type: Ty, name: Type.PrimitiveName): boolean => isPrimitive(widen(type), name)

export const binaryType = (op: Expr.BinaryOperator, left: Ty | undefined, right: Ty | undefined): Ty | undefined => {
  switch (op) {
    case "===":
    case "!==":
    case "<":
    case "<=":
    case ">":
    case ">=":
    case "in":
    case "instanceof":
      return Type.boolean
  }

  if (left === undefined || right === undefined) return undefined

  switch (op) {
    case "&&":
    case "||":
      return logicalType(op, left, right)
    case "+":
      if (widensTo(left, "symbol") || widensTo(right, "symbol")) return undefined
      if (widensTo(left, "string") || widensTo(right, "string")) return Type.string
      if (widensTo(left, "bigint") && widensTo(right, "bigint")) return Type.bigint
      return widensTo(left, "number") && widensTo(right, "number") ? Type.number : undefined
    case "-":
    case "*":
    case "/":
    case "%":
      if (widensTo(left, "bigint") && widensTo(right, "bigint")) return Type.bigint
      return widensTo(left, "number") && widensTo(right, "number") ? Type.number : undefined
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
  : Op extends "in" ?
      [L] extends [string | number | symbol] ?
        [R] extends [object] ? boolean
      : OperandError<Op, L, R>
    : OperandError<Op, L, R>
  : Op extends "instanceof" ?
      [L] extends [object | null | undefined] ?
        [R] extends [abstract new(...args: any[]) => any] ? boolean
      : OperandError<Op, L, R>
    : unknown extends L ?
        [R] extends [abstract new(...args: any[]) => any] ? boolean
      : OperandError<Op, L, R>
    : OperandError<Op, L, R>
  : never

type RequiredKeys<A> = { [K in keyof A]-?: {} extends Pick<A, K> ? never : K }[keyof A]
type ComparablePairSeen<L, R, Seen extends readonly unknown[]> =
    Seen extends readonly [infer Head, ...infer Tail] ?
      Type.Equal<[L, R], Head> extends true ? true
    : ComparablePairSeen<L, R, Tail>
  : false

// A public-property projection cannot reproduce private/protected members.
// Those nominal cases must pass the ordinary relationship check instead.
type PublicMembers<A> = A extends (...args: infer P) => infer R ? ((...args: P) => R) & { [K in keyof A]: A[K] } : { [K in keyof A]: A[K] }

type PropertyComparisons<L, R, Seen extends readonly unknown[]> = {
  [K in keyof L & keyof R]-?: Comparable<Required<Pick<L, K>>[K], Required<Pick<R, K>>[K], Seen>
}[keyof L & keyof R]
type ComparableObjectDirection<L, R, Seen extends readonly unknown[]> =
    [Exclude<RequiredKeys<R>, keyof L>] extends [never] ?
      false extends PropertyComparisons<L, R, Seen> ? false
    : true
  : false

type TuplePositions<A extends readonly unknown[]> = Extract<keyof A, `${number}`>
type Position<A extends readonly unknown[], K extends `${number}`> = K extends `${infer N extends number}` ? Required<Pick<A, N>>[N] : never
type ArrayExtras<A> = Omit<A, keyof any[] | keyof readonly unknown[] | number | `${number}`>
type ComparableArrays<L extends readonly unknown[], R extends readonly unknown[], Seen extends readonly unknown[]> =
    true extends ComparableObjectDirection<ArrayExtras<L>, ArrayExtras<R>, Seen> | ComparableObjectDirection<ArrayExtras<R>, ArrayExtras<L>, Seen> ?
      Comparable<L["length"], R["length"], Seen> extends false ? false
    : number extends L["length"] | R["length"] ? Comparable<L[number], R[number], Seen>
    : false extends {
      [K in TuplePositions<L> & TuplePositions<R>]: Comparable<Position<L, K>, Position<R, K>, Seen>
    }[TuplePositions<L> & TuplePositions<R>] ? false
    : true
  : false

type ParameterComparisons<L extends readonly unknown[], R extends readonly unknown[], Seen extends readonly unknown[]> = {
  [K in TuplePositions<L> & TuplePositions<R>]: K extends `${infer N extends number}` ? Comparable<L[N], R[N], Seen> : never
}[TuplePositions<L> & TuplePositions<R>]
type ComparableFunctions<L extends (...args: any[]) => any, R extends (...args: any[]) => any, Seen extends readonly unknown[]> =
    Comparable<ReturnType<L>, ReturnType<R>, Seen> extends false ? false
  : number extends Parameters<L>["length"] | Parameters<R>["length"] ?
      Comparable<Parameters<L>[number], Parameters<R>[number], Seen> extends false ? false
    : true extends ComparableObjectDirection<L, R, Seen> | ComparableObjectDirection<R, L, Seen> ? true
    : false
  : false extends ParameterComparisons<Parameters<L>, Parameters<R>, Seen> ? false
  : true extends ComparableObjectDirection<L, R, Seen> | ComparableObjectDirection<R, L, Seen> ? true
  : false

type ComparableOne<L, R, Seen extends readonly unknown[]> =
    [L] extends [never] ? true
  : [R] extends [never] ? true
  : [Extract<L, R> | Extract<R, L>] extends [never] ?
      L extends object ?
        R extends object ?
          PublicMembers<L> extends L ?
            PublicMembers<R> extends R ?
              ComparablePairSeen<L, R, Seen> extends true ? true
            : L extends readonly unknown[] ?
                R extends readonly unknown[] ? ComparableArrays<L, R, [...Seen, [L, R]]>
              : false
            : L extends (...args: any[]) => any ?
                R extends (...args: any[]) => any ? ComparableFunctions<L, R, [...Seen, [L, R]]>
              : false
            : true extends ComparableObjectDirection<L, R, [...Seen, [L, R]]> | ComparableObjectDirection<R, L, [...Seen, [L, R]]> ? true
            : false
          : false
        : false
      : false
    : false
  : true

type Comparable<L, R, Seen extends readonly unknown[] = []> =
    [L] extends [never] ? true
  : [R] extends [never] ? true
  : true extends (L extends unknown ? R extends unknown ? ComparableOne<L, R, Seen> : never : never) ? true
  : false

type EqualityResult<Op extends string, L, R> =
    [L] extends [null | undefined] ? boolean
  : [R] extends [null | undefined] ? boolean
  : Comparable<L, R> extends true ? boolean
  : OperandError<Op, L, R>

export type CheckOperands<Op extends Expr.BinaryOperator, L, R> = [BinaryResult<Op, L, R>] extends [OperandError<string, any, any>]
  ? [BinaryResult<Op, L, R>]
  : []

const TYPEOF_RESULTS = ["string", "number", "bigint", "boolean", "symbol", "undefined", "object", "function"] as const

export const unaryType = (op: Expr.UnaryOperator): Ty =>
  op === "!" ? Type.boolean : Type.union(...TYPEOF_RESULTS.map((name) => Type.literal(name)) as [Type.Literal, Type.Literal, ...Type.Literal[]])

export type UnaryResult<Op extends Expr.UnaryOperator> =
    Op extends "!" ? boolean
  : Op extends "typeof" ? (typeof TYPEOF_RESULTS)[number]
  : never

export const propType = (object: Ty | undefined, key: string): Ty | undefined => {
  const node = object as Type.Any | undefined
  if (node?.kind === "intersection") {
    const found = node.members.map((member) => propType(member, key)).filter((type) => type !== undefined)
    const known = found.filter((type) => !isPrimitive(type, "unknown"))
    return known.length === 1 ? known[0] : known.length === 0 && found.length > 0 ? Type.unknown : undefined
  }
  if (node?.kind === "external" && node.name === "Record" && node.args.length === 2) {
    const recordKey = node.args[0] as Type.Any
    return recordKey.kind === "literal" && recordKey.value === key ? node.args[1] : undefined
  }
  const value = node?.kind === "object" ? node.fields[key] : undefined
  if (value === undefined) return undefined
  const field = Type.fieldOf(value)
  return field.optional ? lub([field.type, Type.undefined]) : field.type
}

export type PropResult<O, K extends keyof O> = {} extends Pick<O, K> ? O[K] | undefined : O[K]

const tupleReadType = (tuple: Type.TupleType, index: Type.Type<any> | undefined): Type.Type<any> => {
  const node = index as Type.Any | undefined
  if (node?.kind === "literal" && typeof node.value === "number") return tuple.items[node.value] ?? Type.undefined
  if (node?.kind === "union") return lub(node.members.map((member) => tupleReadType(tuple, member)))
  return lub([...tuple.items, Type.undefined])
}

const indexReadType = (object: Type.Type<any> | undefined, index: Type.Type<any> | undefined): Type.Type<any> | undefined => {
  const node = object as Type.Any | undefined
  if (node?.kind === "array") return lub([node.element, Type.undefined])
  if (node?.kind === "tuple") return tupleReadType(node, index)
  if (node?.kind === "union") {
    const reads = node.members.map((member) => indexReadType(member, index))
    return reads.every((read) => read !== undefined) ? lub(reads) : undefined
  }
  return undefined
}

/** the type of a composite expression, computed from its children's types */
const typeOf = (node: Expr.Composite): Ty | undefined => {
  switch (node.kind) {
    case "prop":
      return propType(node.object.type, node.key)
    case "index":
      return indexReadType(node.object.type, node.index.type)
    case "object": {
      const fields = Object.entries(node.fields).map(([key, value]) => [key, widenFresh(value)] as const)
      return fields.every(([, type]) => type !== undefined) ? Type.object(Object.fromEntries(fields.map(([key, type]) => [key, type!]))) : undefined
    }
    case "array": {
      const element = node.elements.length === 0 ? Type.never : expressionUnion(node.elements, widenFresh)
      return element === undefined ? undefined : Type.array(element)
    }
    case "binary":
      return binaryType(node.op, node.left.type, node.right.type)
    case "unary":
      return unaryType(node.op)
    case "template":
      return Type.string
    case "cond":
      return node.then.type !== undefined && node.else.type !== undefined ? lub([node.then.type, node.else.type]) : undefined
    case "call":
      return callType(node.callee)
    case "instantiation":
      return node.callee.type === undefined ? undefined : substitute(node.callee.type, node.callee.typeParams, node.typeArgs)
    case "arrow":
      return signatureType(node.params, node.returnType ?? blockReturnType(node.body))
  }
}

export type Unbuilt<N> = N extends unknown ? Omit<N, Exclude<keyof Node, "kind"> | "type"> : never

/** makes a composite expression node, typed from its children */
export const typed = (fields: Unbuilt<Expr.Composite>): Expr.Composite => {
  const node = makeNode(fields) as Expr.Composite
  return Object.assign(node, { type: typeOf(node) })
}

export const elementType = (iterable: Ty | undefined): Ty | undefined => {
  const node = iterable as Type.Any | undefined
  if (node?.kind === "array") return node.element
  if (node?.kind === "tuple") return node.items.length === 0 ? Type.never : lub(node.items)
  if (node?.kind === "union") {
    const elements = node.members.map(elementType)
    return elements.every((element) => element !== undefined) ? lub(elements) : undefined
  }
  if (node !== undefined && widensTo(node, "string")) return Type.string
  return undefined
}

export type ElementOf<A> =
    A extends readonly (infer E)[] ? E
  : A extends string ? string
  : never
