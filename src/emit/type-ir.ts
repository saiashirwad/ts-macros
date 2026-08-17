import * as Type from "../types/index.ts"

type TypeNode = Type.TypeExpr<any>

const primitiveOf = (value: string | number | boolean): TypeNode =>
  typeof value === "string" ? Type.String() : typeof value === "number" ? Type.Number() : Type.Boolean()

export const widen = (type: TypeNode): TypeNode => {
  const node = type as Type.Any
  switch (node.tag) {
    case "literal":
      return node.value === null ? type : primitiveOf(node.value)
    case "object":
      return Type.Object(
        Object.fromEntries(Object.entries(node.fields).map(([key, value]) => [key, widen(value)])),
      )
    case "array":
      return Type.Array(widen(node.element))
    case "tuple":
      return Type.Tuple(...node.items.map(widen))
    case "union":
      return Type.Union(...(node.members.map(widen) as [TypeNode, TypeNode, ...TypeNode[]]))
    default:
      return type
  }
}
