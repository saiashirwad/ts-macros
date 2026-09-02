import type { BinaryOperator } from "../expr.ts"
import { makeTypeNode } from "../pipeable.ts"
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
        && keys.every((key) => Object.hasOwn(fields, key) && sameType(left.fields[key]!, fields[key]!))
    }
    case "readonly-field":
    case "optional-field":
      return sameType(left.field, (other as Type.ReadonlyField).field)
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
      return left.name === (other as Type.TypeRef).name
        && sameTypes(left.args ?? [], (other as Type.TypeRef).args ?? [])
        && sameOptional(left.erasesTo, (other as Type.TypeRef).erasesTo)
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
    case "readonly-field":
    case "optional-field":
      return makeTypeNode({ ...node, field: widen(node.field) })
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

/** replaces type params by position, rebuilding every node that contains one */
export const substitute = (type: TypeNode, params: Type.AnyParams, args: TypeNode[]): TypeNode => {
  const node = type as Type.Any
  const sub = (child: TypeNode): TypeNode => substitute(child, params, args)
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
      return Type.Object(Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, sub(value)])))
    case "readonly-field":
    case "optional-field":
      return makeTypeNode({ ...node, field: sub(node.field) })
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
      return node.args === undefined ? type : makeTypeNode({ ...node, args: node.args.map(sub) })
  }
}

/** what `const x = value` does to the type of `value`: a top-level literal is kept, an object's fields widen */
export const constWiden = (type: TypeNode): TypeNode => ((type as Type.Any).tag === "object" ? widen(type) : type)

/** the type TypeScript infers for a function from its returns: a single literal widens, a union of them is kept, objects widen */
export const returnTypeOf = (returns: readonly TypeNode[]): TypeNode => {
  const joined = lub(returns) as Type.Any
  return joined.tag === "union"
    ? lub(joined.members.map((member: TypeNode) => ((member as Type.Any).tag === "object" ? widen(member) : member)))
    : widen(joined)
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
