import * as t from "@babel/types"

import type { TSTypeDescriptor } from "../ir"
import { TypeRef } from "../refs"
import { assertNever, identifierFromName } from "./shared"

export function typeDescriptorToImplementsClause(
  typeDesc: TSTypeDescriptor | TypeRef<unknown>,
): t.TSExpressionWithTypeArguments {
  if (typeDesc instanceof TypeRef) {
    return typeDescriptorToImplementsClause(typeDesc.toDescriptor())
  }

  if (typeDesc.kind === "generic") {
    return t.tsExpressionWithTypeArguments(
      identifierFromName(typeDesc.name, "Class implements clause"),
      typeDesc.args.length
        ? t.tsTypeParameterInstantiation(typeDesc.args.map(typeDescriptorToTSType))
        : null,
    )
  }

  if (typeDesc.kind === "reference") {
    return t.tsExpressionWithTypeArguments(
      identifierFromName(typeDesc.name, "Class implements clause"),
      typeDesc.typeArgs?.length
        ? t.tsTypeParameterInstantiation(typeDesc.typeArgs.map(typeDescriptorToTSType))
        : null,
    )
  }

  throw new Error(
    `Class implements clauses must be reference or generic types, received ${typeDesc.kind}`,
  )
}

export function typeDescriptorToTSType(typeDesc: TSTypeDescriptor | TypeRef<unknown>): t.TSType {
  if (typeDesc instanceof TypeRef) {
    return typeDescriptorToTSType(typeDesc.toDescriptor())
  }

  switch (typeDesc.kind) {
    case "primitive":
      switch (typeDesc.name) {
        case "string":
          return t.tsStringKeyword()
        case "number":
          return t.tsNumberKeyword()
        case "boolean":
          return t.tsBooleanKeyword()
        case "any":
          return t.tsAnyKeyword()
        case "void":
          return t.tsVoidKeyword()
        case "undefined":
          return t.tsUndefinedKeyword()
        case "null":
          return t.tsNullKeyword()
        case "never":
          return t.tsNeverKeyword()
        case "unknown":
          return t.tsUnknownKeyword()
      }
      break

    case "array":
      return t.tsArrayType(typeDescriptorToTSType(typeDesc.elementType))

    case "union":
      return t.tsUnionType(typeDesc.types.map(typeDescriptorToTSType))

    case "intersection":
      return t.tsIntersectionType(typeDesc.types.map(typeDescriptorToTSType))

    case "function": {
      const params = typeDesc.params.map((paramType, index) => {
        const param = t.identifier(`arg${index}`)
        param.typeAnnotation = t.tsTypeAnnotation(typeDescriptorToTSType(paramType))
        return param
      })
      const returnType = t.tsTypeAnnotation(typeDescriptorToTSType(typeDesc.returnType))
      return t.tsFunctionType(null, params, returnType)
    }

    case "object":
      return t.tsTypeLiteral(
        Object.entries(typeDesc.properties).map(([key, propType]) => {
          const normalized =
            propType && typeof propType === "object" && "type" in propType
              ? (propType as {
                  type: TSTypeDescriptor
                  optional?: boolean
                  readonly?: boolean
                })
              : {
                  type: propType as TSTypeDescriptor,
                  optional: false,
                  readonly: false,
                }

          const propSig = t.tsPropertySignature(
            t.identifier(key),
            t.tsTypeAnnotation(typeDescriptorToTSType(normalized.type)),
          )
          if (normalized.optional) propSig.optional = true
          if (normalized.readonly) propSig.readonly = true
          return propSig
        }),
      )

    case "generic":
      if (typeDesc.args.length === 0) {
        return t.tsTypeReference(t.identifier(typeDesc.name))
      }
      return t.tsTypeReference(
        t.identifier(typeDesc.name),
        t.tsTypeParameterInstantiation(typeDesc.args.map(typeDescriptorToTSType)),
      )

    case "reference":
      return t.tsTypeReference(
        t.identifier(typeDesc.name),
        typeDesc.typeArgs?.length
          ? t.tsTypeParameterInstantiation(typeDesc.typeArgs.map(typeDescriptorToTSType))
          : undefined,
      )

    case "literal":
      if (typeDesc.value === null) {
        return t.tsNullKeyword()
      }
      if (typeof typeDesc.value === "string") {
        return t.tsLiteralType(t.stringLiteral(typeDesc.value))
      }
      if (typeof typeDesc.value === "number") {
        return t.tsLiteralType(t.numericLiteral(typeDesc.value))
      }
      return t.tsLiteralType(t.booleanLiteral(typeDesc.value))

    case "tuple":
      return t.tsTupleType(
        typeDesc.types.map((el) => {
          const normalized =
            el && typeof el === "object" && "type" in el
              ? (el as { type: TSTypeDescriptor; optional?: boolean })
              : { type: el as TSTypeDescriptor, optional: false }
          const tsType = typeDescriptorToTSType(normalized.type)
          return normalized.optional ? t.tsOptionalType(tsType) : tsType
        }),
      )

    case "mapped": {
      const typeParam = t.tsTypeParameter(
        typeDesc.typeParam.constraint
          ? typeDescriptorToTSType(typeDesc.typeParam.constraint)
          : null,
        typeDesc.typeParam.default ? typeDescriptorToTSType(typeDesc.typeParam.default) : null,
        typeDesc.typeParam.name,
      )
      const mapped = t.tsMappedType(
        typeParam,
        typeDescriptorToTSType(typeDesc.valueType),
        typeDesc.nameType ? typeDescriptorToTSType(typeDesc.nameType) : undefined,
      )
      if (typeDesc.readonly !== undefined) mapped.readonly = typeDesc.readonly
      if (typeDesc.optional !== undefined) mapped.optional = typeDesc.optional
      return mapped
    }

    case "conditional":
      return t.tsConditionalType(
        typeDescriptorToTSType(typeDesc.checkType),
        typeDescriptorToTSType(typeDesc.extendsType),
        typeDescriptorToTSType(typeDesc.trueType),
        typeDescriptorToTSType(typeDesc.falseType),
      )

    case "indexed-access":
      return t.tsIndexedAccessType(
        typeDescriptorToTSType(typeDesc.objectType),
        typeDescriptorToTSType(typeDesc.indexType),
      )

    case "typeof":
      return t.tsTypeQuery(identifierFromName(typeDesc.name, "Typeof query name"))

    case "keyof": {
      const op = t.tsTypeOperator(typeDescriptorToTSType(typeDesc.type))
      op.operator = "keyof"
      return op
    }

    case "template-literal": {
      const quasis: t.TemplateElement[] = [
        t.templateElement(
          { raw: typeDesc.head, cooked: typeDesc.head },
          typeDesc.spans.length === 0,
        ),
      ]
      const types: t.TSType[] = []
      typeDesc.spans.forEach((span, idx) => {
        types.push(typeDescriptorToTSType(span.type))
        const isTail = idx === typeDesc.spans.length - 1
        quasis.push(t.templateElement({ raw: span.literal, cooked: span.literal }, isTail))
      })
      return (t as any).tsTemplateLiteralType(quasis, types)
    }

    case "infer": {
      const tp = t.tsTypeParameter(
        typeDesc.constraint ? typeDescriptorToTSType(typeDesc.constraint) : null,
        null,
        typeDesc.name,
      )
      return t.tsInferType(tp)
    }
  }

  return assertNever(typeDesc as never, "type descriptor")
}

export function parseTypeString(typeStr: string): TSTypeDescriptor {
  switch (typeStr) {
    case "string":
      return { kind: "primitive", name: "string" }
    case "number":
      return { kind: "primitive", name: "number" }
    case "boolean":
      return { kind: "primitive", name: "boolean" }
    case "any":
      return { kind: "primitive", name: "any" }
    case "void":
      return { kind: "primitive", name: "void" }
    case "undefined":
      return { kind: "primitive", name: "undefined" }
    case "null":
      return { kind: "primitive", name: "null" }
    case "never":
      return { kind: "primitive", name: "never" }
    case "unknown":
      return { kind: "primitive", name: "unknown" }
    default:
      if (typeStr.endsWith("[]")) {
        const elementType = parseTypeString(typeStr.slice(0, -2))
        return { kind: "array", elementType }
      }
      if (typeStr.includes(" | ")) {
        const unionTypes = typeStr.split(" | ").map(parseTypeString)
        return { kind: "union", types: unionTypes }
      }
      if (typeStr.includes(" & ")) {
        const intersectionTypes = typeStr.split(" & ").map(parseTypeString)
        return { kind: "intersection", types: intersectionTypes }
      }
      return { kind: "reference", name: typeStr }
  }
}
