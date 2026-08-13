import * as t from "@babel/types"

import type * as Type from "../types/index.ts"
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

const needsArrayParens = (element: Type.Any): boolean =>
  element.tag === "infer-var" || element.tag === "union" || element.tag === "intersection" || element.tag === "function"
  || element.tag === "conditional"

const fieldToBabel = (key: string, field: Type.TypeExpr<any>): t.TSPropertySignature => {
  let readonly = false
  let optional = false
  let current = field as Type.Any
  while (current.tag === "readonly-field" || current.tag === "optional-field") {
    if (current.tag === "readonly-field") readonly = true
    if (current.tag === "optional-field") optional = true
    current = current.field as Type.Any
  }
  const signature = t.tsPropertySignature(ident(key, "object type field"), t.tsTypeAnnotation(typeExprToBabel(current)))
  if (readonly) signature.readonly = true
  if (optional) signature.optional = true
  return signature
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
        Object.entries(node.fields).map(([key, value]) => fieldToBabel(key, value)),
      )
    case "union":
      return t.tsUnionType(node.members.map(typeExprToBabel))
    case "intersection":
      return t.tsIntersectionType(node.members.map(typeExprToBabel))
    case "indexed-access":
      return t.tsIndexedAccessType(typeExprToBabel(node.object), typeExprToBabel(node.key))
    case "keyof":
      return t.tsTypeOperator(typeExprToBabel(node.operand), "keyof")
    case "conditional":
      return t.tsConditionalType(
        typeExprToBabel(node.check),
        typeExprToBabel(node.extends),
        typeExprToBabel(node.then),
        typeExprToBabel(node.else),
      )
    case "mapped": {
      const mapped = t.tsMappedType(
        t.tsTypeParameter(t.tsTypeOperator(typeExprToBabel(node.source), "keyof"), null, node.key),
        typeExprToBabel(node.body),
      )
      return mapped
    }
    case "template-literal": {
      if (node.parts.length !== node.exprs.length + 1) {
        throw new Error(
          `cannot emit a template literal type with ${node.parts.length} parts and ${node.exprs.length} exprs`
            + ` (expected ${node.exprs.length + 1} parts)`,
        )
      }
      return t.tsTemplateLiteralType(
        node.parts.map((part) => t.templateElement({ raw: part, cooked: part })),
        node.exprs.map(typeExprToBabel),
      )
    }
    case "infer-var":
      return t.tsInferType(t.tsTypeParameter(null, null, node.name))
    case "readonly-field":
    case "optional-field":
      throw new Error(`"${node.tag}" is a field modifier and only valid inside object types`)
    case "array": {
      const element = typeExprToBabel(node.element)
      return t.tsArrayType(needsArrayParens(node.element as Type.Any) ? t.tsParenthesizedType(element) : element)
    }
    case "tuple":
      return t.tsTupleType(node.items.map(typeExprToBabel))
    case "function": {
      const params: (t.Identifier | t.RestElement)[] = node.params.map((param, index) => {
        const arg = ident(`arg${index}`, "function type param")
        arg.typeAnnotation = t.tsTypeAnnotation(typeExprToBabel(param))
        return arg
      })
      if (node.rest !== undefined) {
        const rest = t.restElement(ident(`arg${node.params.length}`, "function type rest param"))
        rest.typeAnnotation = t.tsTypeAnnotation(typeExprToBabel(node.rest))
        params.push(rest)
      }
      return t.tsFunctionType(null, params, t.tsTypeAnnotation(typeExprToBabel(node.return)))
    }
    case "type-ref":
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
