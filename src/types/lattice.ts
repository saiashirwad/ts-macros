import type { BinaryOperator } from "../expr.ts"
import type { TypeExpr } from "./core.ts"
import * as Type from "./index.ts"

type TypeNode = TypeExpr<any>

const primitiveOf = (value: string | number | boolean): TypeNode =>
  typeof value === "string" ? Type.String() : typeof value === "number" ? Type.Number() : Type.Boolean()

const sameOptional = (a: TypeNode | undefined, b: TypeNode | undefined): boolean =>
  a === undefined && b === undefined ? true : a !== undefined && b !== undefined && sameType(a, b)

const sameTypes = (as: readonly TypeNode[], bs: readonly TypeNode[]): boolean =>
  as.length === bs.length && as.every((type, index) => sameType(type, bs[index]!))

const sameTypeSet = (as: readonly TypeNode[], bs: readonly TypeNode[]): boolean => {
  if (as.length !== bs.length) return false
  const unused = [...bs]
  return as.every((type) => {
    const index = unused.findIndex((seen) => sameType(type, seen))
    if (index === -1) return false
    unused.splice(index, 1)
    return true
  })
}

export const sameType = (a: TypeNode, b: TypeNode): boolean => {
  const left = a as Type.Any
  const right = b as Type.Any
  if (left.tag !== right.tag) return false

  switch (left.tag) {
    case "primitive":
      return left.name === (right as Type.Primitive).name
    case "literal":
      return left.value === (right as Type.Literal).value
    case "param":
      return left.name === (right as Type.AnyParam).name && sameOptional(left.extends, (right as Type.AnyParam).extends)
    case "object": {
      const other = (right as Type.Object).fields
      const keys = Object.keys(left.fields)
      return keys.length === Object.keys(other).length
        && keys.every((key) => Object.hasOwn(other, key) && sameType(left.fields[key]!, other[key]!))
    }
    case "union":
      return sameTypeSet(left.members, (right as Type.Union<any>).members)
    case "array":
      return sameType(left.element, (right as Type.ArrayType).element)
    case "tuple":
      return sameTypes(left.items, (right as Type.TupleType).items)
    case "function":
      return sameTypes(left.params, (right as Type.FunctionType).params)
        && sameType(left.return, (right as Type.FunctionType).return)
    case "type-ref": {
      const other = right as Type.TypeRef
      return left.name === other.name
        && sameTypes(left.args ?? [], other.args ?? [])
        && sameOptional(left.erasesTo, other.erasesTo)
    }
    case "application": {
      const other = right as Type.Application
      return sameType(left.callee, other.callee) && sameTypes(left.args, other.args)
    }
    default:
      return false
  }
}

export const lub = (types: readonly TypeNode[]): TypeNode => {
  const distinct: TypeNode[] = []
  for (const type of types) {
    if (!distinct.some((seen) => sameType(seen, type))) distinct.push(type)
  }
  return distinct.length === 1 ? distinct[0]! : Type.Union(...distinct as [TypeNode, TypeNode, ...TypeNode[]])
}

export const widen = (type: TypeNode): TypeNode => {
  const node = type as Type.Any
  switch (node.tag) {
    case "literal":
      return node.value === null ? type : primitiveOf(node.value)
    case "object":
      return Type.Object(Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, widen(value)])))
    case "array":
      return Type.Array(widen(node.element))
    case "tuple":
      return Type.Tuple(...node.items.map(widen))
    case "union":
      return lub(node.members.map(widen))
    case "application":
      return Type.Apply(node.callee, node.args.map(widen))
    default:
      return type
  }
}

const isPrimitive = (type: TypeNode, name: Type.PrimitiveName): boolean => {
  const node = type as Type.Any
  return node.tag === "primitive" && node.name === name
}

const resolveDefault = (type: TypeNode): TypeNode => type

const keepNominalNumber = (left: TypeNode, right: TypeNode): TypeNode =>
  sameType(left, right) && (left as Type.Any).tag === "type-ref" ? left : Type.Number()

export const binaryType = (
  op: BinaryOperator,
  left: TypeNode | undefined,
  right: TypeNode | undefined,
  resolve: (type: TypeNode) => TypeNode = resolveDefault,
): TypeNode | undefined => {
  switch (op) {
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
    case "+": {
      const resolvedLeft = resolve(widen(left))
      const resolvedRight = resolve(widen(right))
      if (isPrimitive(resolvedLeft, "string") || isPrimitive(resolvedRight, "string")) return Type.String()
      if (isPrimitive(resolvedLeft, "number") && isPrimitive(resolvedRight, "number")) {
        return keepNominalNumber(left, right)
      }
      return undefined
    }
    case "-":
    case "*":
    case "/":
    case "%": {
      const resolvedLeft = resolve(widen(left))
      const resolvedRight = resolve(widen(right))
      if (!isPrimitive(resolvedLeft, "number") || !isPrimitive(resolvedRight, "number")) return undefined
      return keepNominalNumber(left, right)
    }
  }
}
