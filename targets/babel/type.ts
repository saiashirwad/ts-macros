import * as t from "@babel/types"

import type * as Type from "../../src/types/index.ts"
import { assertNever, ident } from "./shared.ts"

const primitiveToBabel = (name: Type.PrimitiveName): t.TSType => {
  switch (name) {
    case "string":
      return t.tsStringKeyword()
    case "number":
      return t.tsNumberKeyword()
    case "boolean":
      return t.tsBooleanKeyword()
    case "undefined":
      return t.tsUndefinedKeyword()
    case "null":
      return t.tsNullKeyword()
    case "void":
      return t.tsVoidKeyword()
    case "never":
      return t.tsNeverKeyword()
    case "unknown":
      return t.tsUnknownKeyword()
    case "any":
      return t.tsAnyKeyword()
    default:
      return assertNever(name)
  }
}

export const typeExprToBabel = (type: Type.TypeExpr<any>): t.TSType => {
  const node = type as Type.Any
  switch (node.tag) {
    case "primitive":
      return primitiveToBabel(node.name)
    case "literal":
      return node.value === null
        ? t.tsNullKeyword()
        : t.tsLiteralType(
          typeof node.value === "string"
            ? t.stringLiteral(node.value)
            : typeof node.value === "number"
            ? t.numericLiteral(node.value)
            : t.booleanLiteral(node.value),
        )
    case "object":
      return t.tsTypeLiteral(
        Object.entries(node.fields).map(([key, value]) =>
          t.tsPropertySignature(ident(key, "object type field"), t.tsTypeAnnotation(typeExprToBabel(value)))
        ),
      )
    case "union":
      return t.tsUnionType(node.members.map(typeExprToBabel))
    case "array":
      return t.tsArrayType(typeExprToBabel(node.element))
    case "tuple":
      return t.tsTupleType(node.items.map(typeExprToBabel))
    case "function":
      return t.tsFunctionType(
        null,
        node.params.map((param, index) => {
          const arg = ident(`arg${index}`, "function type param")
          arg.typeAnnotation = t.tsTypeAnnotation(typeExprToBabel(param))
          return arg
        }),
        t.tsTypeAnnotation(typeExprToBabel(node.return)),
      )
    case "type-ref":
      if (node.erasesTo !== undefined) {
        return typeExprToBabel(node.erasesTo)
      }
      return t.tsTypeReference(
        ident(node.name, "type-ref"),
        node.args !== undefined && node.args.length > 0
          ? t.tsTypeParameterInstantiation(node.args.map(typeExprToBabel))
          : null,
      )
    case "application": {
      const callee = node.callee as Type.Any
      if (callee.tag !== "type-ref") {
        throw new Error(`cannot emit a type application whose callee is "${callee.tag}" (expected "type-ref")`)
      }
      return t.tsTypeReference(
        ident(callee.name, "type application"),
        t.tsTypeParameterInstantiation(node.args.map(typeExprToBabel)),
      )
    }
    case "param":
      return t.tsTypeReference(ident(node.name, "type param"))
    default:
      return assertNever(node)
  }
}
