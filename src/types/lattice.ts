import type { BinaryOperator } from "../expr.ts"
import type { TypeExpr } from "./core.ts"
import * as Type from "./index.ts"

type TypeNode = TypeExpr<any>

const primitiveOf = (value: string | number | boolean): TypeNode =>
  typeof value === "string" ? Type.String() : typeof value === "number" ? Type.Number() : Type.Boolean()

const sameOptional = (a: TypeNode | undefined, b: TypeNode | undefined): boolean => a === undefined || b === undefined ? a === b : sameType(a, b)

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

/** structural equality of type nodes */
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
      return sameTypeSet(left.members, (right as Type.Union).members)
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
  }
}

/** least upper bound: the union of the distinct members, or the single member */
export const lub = (types: readonly TypeNode[]): TypeNode => {
  const distinct: TypeNode[] = []
  for (const type of types) {
    if (!distinct.some((seen) => sameType(seen, type))) distinct.push(type)
  }
  return distinct.length === 1 ? distinct[0]! : Type.Union(...distinct as [TypeNode, TypeNode, ...TypeNode[]])
}

/** literal types become their primitive, recursively; what `let x = 1` does to `1` */
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
    default:
      return type
  }
}

/** the structural type behind a nominal reference, or the type itself */
const erase = (type: TypeNode): TypeNode => {
  const node = type as Type.Any
  return node.tag === "type-ref" && node.erasesTo !== undefined ? erase(node.erasesTo) : type
}

const isPrimitive = (type: TypeNode, name: Type.PrimitiveName): boolean => {
  const node = erase(widen(type)) as Type.Any
  return node.tag === "primitive" && node.name === name
}

/** arithmetic on two of the same nominal number keeps the nominal (`Int + Int` is `Int`) */
const numeric = (left: TypeNode, right: TypeNode): TypeNode => sameType(left, right) && (left as Type.Any).tag === "type-ref" ? left : Type.Number()

/** the type of `left op right`, or undefined when the operands do not admit the operator */
export const binaryType = (op: BinaryOperator, left: TypeNode | undefined, right: TypeNode | undefined): TypeNode | undefined => {
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
    case "+":
      if (isPrimitive(left, "string") || isPrimitive(right, "string")) return Type.String()
      return isPrimitive(left, "number") && isPrimitive(right, "number") ? numeric(left, right) : undefined
    case "-":
    case "*":
    case "/":
    case "%":
      return isPrimitive(left, "number") && isPrimitive(right, "number") ? numeric(left, right) : undefined
  }
}

/** the type a `for (const x of iterable)` variable takes */
export const elementType = (iterable: TypeNode | undefined): TypeNode | undefined => {
  const node = iterable as Type.Any | undefined
  if (node?.tag === "array") return node.element
  if (node !== undefined && isPrimitive(node, "string")) return Type.String()
  return undefined
}
