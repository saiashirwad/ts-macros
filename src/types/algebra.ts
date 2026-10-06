import { makeType } from "../node.ts"
import type { Generic, Variable } from "./core.ts"
import * as Type from "./index.ts"

type Ty = Type.Type<any>

export const isPrimitive = (type: Ty, ...names: Type.PrimitiveName[]): boolean => {
  const node = type as Type.AnyType
  return node.kind === "primitive" && names.includes(node.name)
}

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

const mapFields = (node: Type.Object, f: (type: Ty) => Ty): Ty =>
  Type.Object(Object.fromEntries(
    Object.entries(node.fields).map(([key, value]) => [key, Type.isField(value) ? { ...value, type: f(value.type) } : f(value)]),
  ))

export const sameType = (a: Ty, b: Ty): boolean => {
  const left = a as Type.AnyType
  const right = b as Type.AnyType
  if (left.kind !== right.kind) return false
  const other = right as never

  switch (left.kind) {
    case "primitive":
      return left.name === (other as Type.Primitive).name
    case "literal":
      return left.value === (other as Type.LiteralType).value
    case "template-literal":
      return left.parts.length === (other as Type.TemplateLiteralType).parts.length
        && left.parts.every((part, index) => part === (other as Type.TemplateLiteralType).parts[index])
        && sameTypes(left.exprs, (other as Type.TemplateLiteralType).exprs)
    case "param":
      return left.name === (other as Type.AnyTypeParam).name && sameOptional(left.extends, (other as Type.AnyTypeParam).extends)
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
      return left.readonly === (other as Type.ArrayType<Type.Type<any>, boolean>).readonly
        && sameType(left.element, (other as Type.ArrayType).element)
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
    case "logical":
      return left.op === (other as Type.Logical).op
        && sameType(left.left, (other as Type.Logical).left)
        && sameType(left.right, (other as Type.Logical).right)
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
      return left.id === (other as Type.TypeRef).id && sameTypes(left.args, (other as Type.TypeRef).args)
    case "external":
      return left.name === (other as Type.ExternalType).name && sameTypes(left.args, (other as Type.ExternalType).args)
  }
}

export const lub = (types: readonly Ty[]): Ty => {
  const distinct: Ty[] = []
  for (const type of types) {
    if (!distinct.some((seen) => sameType(seen, type))) distinct.push(type)
  }
  return distinct.length === 1 ? distinct[0]! : Type.Union(...distinct as [Ty, Ty, ...Ty[]])
}

const primitiveOf = (value: string | number | bigint | boolean): Ty =>
  typeof value === "string" ? Type.String : typeof value === "number" ? Type.Number : typeof value === "bigint" ? Type.BigInt : Type.Boolean

export const widen = (type: Ty): Ty => {
  const node = type as Type.AnyType
  switch (node.kind) {
    case "literal":
      return node.value === null ? type : primitiveOf(node.value)
    case "object":
      return mapFields(node, widen)
    case "array":
      return node.readonly ? Type.ReadonlyArray(widen(node.element)) : Type.Array(widen(node.element))
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
  : A extends bigint ? bigint
  : A extends boolean ? boolean
  : A extends (...args: any[]) => any ? A
  : A extends object ? { [K in keyof A]: Widen<A[K]> }
  : A

interface TypeBinding {
  readonly name: string
  readonly argument: Ty | undefined
}

export const substitute = (type: Ty, params: Type.AnyTypeParams, args: Ty[]): Ty =>
  substituteWith(type, params.map((param, index) => ({ name: param.name, argument: args[index] })))

const substituteWith = (type: Ty, bindings: readonly TypeBinding[]): Ty => {
  const node = type as Type.AnyType
  const sub = (child: Ty): Ty => substituteWith(child, bindings)
  switch (node.kind) {
    case "param": {
      return bindings.find((binding) => binding.name === node.name)?.argument ?? type
    }
    case "primitive":
    case "literal":
    case "infer-var":
      return type
    case "template-literal":
      return makeType({ ...node, exprs: node.exprs.map(sub) })
    case "object":
      return mapFields(node, sub)
    case "union":
    case "intersection":
      return makeType({ ...node, members: node.members.map(sub) })
    case "array":
      return node.readonly ? Type.ReadonlyArray(sub(node.element)) : Type.Array(sub(node.element))
    case "tuple":
      return Type.Tuple(...node.items.map(sub))
    case "function":
      return Type.Function(node.params.map(sub), sub(node.return), node.rest === undefined ? undefined : sub(node.rest))
    case "indexed-access":
      return Type.IndexedAccess(sub(node.object), sub(node.key))
    case "keyof":
      return Type.KeyOf(sub(node.operand))
    case "logical": {
      const left = sub(node.left)
      const right = sub(node.right)
      return isSymbolic(left) || isSymbolic(right) ? Type.Logical(node.op, left, right) : logicalType(node.op === "and" ? "&&" : "||", left, right)
    }
    case "conditional":
      return Type.Conditional(sub(node.check), sub(node.extends), sub(node.then), sub(node.else))
    case "mapped": {
      const shadowed = bindings.findIndex((binding) => binding.name === node.key)
      const bodyBindings = shadowed === -1 ? bindings : bindings.filter((_, index) => index !== shadowed)
      return Type.Mapped(node.key, sub(node.source), substituteWith(node.body, bodyBindings))
    }
    case "type-ref":
    case "external":
      return makeType({ ...node, args: node.args.map(sub) })
  }
}

const isSymbolic = (type: Ty): boolean => {
  const node = type as Type.AnyType
  switch (node.kind) {
    case "param":
    case "logical":
      return true
    case "union":
    case "intersection":
      return node.members.some(isSymbolic)
    case "array":
      return isSymbolic(node.element)
    case "tuple":
      return node.items.some(isSymbolic)
    default:
      return false
  }
}

const logicalMembers = (type: Ty): readonly Ty[] => {
  const node = type as Type.AnyType
  return node.kind === "union"
    ? node.members.flatMap(logicalMembers).filter((member) => !isPrimitive(member, "never"))
    : [type]
}

const isFalsyType = (type: Ty): boolean => {
  const node = type as Type.AnyType
  return node.kind === "literal"
    ? node.value === false || node.value === 0 || node.value === 0n || node.value === "" || node.value === null
    : isPrimitive(type, "null", "undefined", "never")
}

const isTruthyType = (type: Ty): boolean => {
  const node = type as Type.AnyType
  if (node.kind === "literal") return node.value !== false && node.value !== 0 && node.value !== 0n && node.value !== "" && node.value !== null
  return node.kind === "object" || node.kind === "array" || node.kind === "tuple" || node.kind === "function"
    || isPrimitive(type, "symbol", "object")
}

const falsyPart = (type: Ty): readonly Ty[] => {
  const node = type as Type.AnyType
  if (isFalsyType(type)) return [type]
  if (isTruthyType(type)) return []
  if (node.kind === "primitive") {
    if (node.name === "boolean") return [Type.Literal(false)]
    if (node.name === "string") return [Type.Literal("")]
    if (node.name === "number") return [Type.Literal(0)]
    if (node.name === "bigint") return [Type.Literal(0n)]
  }
  return [type]
}

const truthyPart = (type: Ty): readonly Ty[] => {
  if (isTruthyType(type)) return [type]
  if (isFalsyType(type)) return []
  if (isPrimitive(type, "unknown")) return [Type.Object({})]
  if (isPrimitive(type, "boolean")) return [Type.Literal(true)]
  // TypeScript cannot spell broad nonempty strings or nonzero numbers, so it keeps the broad type.
  return [type]
}

interface LogicalChoices {
  readonly left: readonly Ty[]
  readonly right: boolean
}

export const logicalChoices = (op: "&&" | "||", left: Ty): LogicalChoices => {
  if (isPrimitive(left, "never")) return { left: [], right: false }
  const members = logicalMembers(left)
  return {
    left: op === "&&" ? members.flatMap(falsyPart) : members.flatMap(truthyPart),
    right: op === "&&" ? members.some((member) => truthyPart(member).length > 0) : members.some((member) => falsyPart(member).length > 0),
  }
}

export const logicalType = (op: "&&" | "||", left: Ty, right: Ty, freshLeft = false, rightResult: Ty = right): Ty => {
  if (isSymbolic(left) || isSymbolic(right)) return Type.Logical(op === "&&" ? "and" : "or", left, right)
  if (isPrimitive(left, "unknown")) return op === "&&" ? Type.Unknown : Type.Object({})
  const members = logicalMembers(left)
  if (members.length === 1 && isPrimitive(members[0]!, "never")) return Type.Never
  const choices = logicalChoices(op, left)
  const chosen = freshLeft ? choices.left.map(widen) : choices.left
  return lub(choices.right ? [...chosen, rightResult] : chosen)
}
