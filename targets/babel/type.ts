import * as t from "@babel/types"

import type { TypeHandlers } from "../../src/emit/target.ts"
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

export const babelTypes: TypeHandlers<t.Expression, t.Statement, t.TSType> = {
  primitive: (node) => primitiveToBabel(node.name),
  literal: (node) =>
    node.value === null
      ? t.tsNullKeyword()
      : t.tsLiteralType(
        typeof node.value === "string"
          ? t.stringLiteral(node.value)
          : typeof node.value === "number"
          ? t.numericLiteral(node.value)
          : t.booleanLiteral(node.value),
      ),
  object: (node, emit) =>
    t.tsTypeLiteral(
      Object.entries(node.fields).map(([key, value]) => t.tsPropertySignature(ident(key, "object type field"), t.tsTypeAnnotation(emit.type(value)))),
    ),
  union: (node, emit) => t.tsUnionType(node.members.map((member: Type.TypeExpr<any>) => emit.type(member))),
  array: (node, emit) => t.tsArrayType(emit.type(node.element)),
  tuple: (node, emit) => t.tsTupleType(node.items.map((item) => emit.type(item))),
  function: (node, emit) =>
    t.tsFunctionType(
      null,
      node.params.map((param, index) => {
        const argument = ident(`arg${index}`, "function type param")
        argument.typeAnnotation = t.tsTypeAnnotation(emit.type(param))
        return argument
      }),
      t.tsTypeAnnotation(emit.type(node.return)),
    ),
  "type-ref": (node, emit) => {
    if (node.erasesTo !== undefined) return emit.type(node.erasesTo)
    return t.tsTypeReference(
      ident(node.name, "type-ref"),
      node.args !== undefined && node.args.length > 0
        ? t.tsTypeParameterInstantiation(node.args.map((argument) => emit.type(argument)))
        : null,
    )
  },
  application: (node, emit) => {
    const callee = node.callee as Type.Any
    if (callee.tag !== "type-ref") {
      throw new Error(`cannot emit a type application whose callee is "${callee.tag}" (expected "type-ref")`)
    }
    return t.tsTypeReference(
      ident(callee.name, "type application"),
      t.tsTypeParameterInstantiation(node.args.map((argument) => emit.type(argument))),
    )
  },
  param: (node) => t.tsTypeReference(ident(node.name, "type param")),
}
