import { makeTypeNode } from "../../pipeable.ts"
import type { TypeExpr } from "../core.ts"

interface PrimitiveDenotations {
  readonly string: string
  readonly number: number
  readonly boolean: boolean
  readonly undefined: undefined
  readonly null: null
  readonly void: void
  readonly never: never
  readonly unknown: unknown
  readonly any: any
}

export type PrimitiveName = keyof PrimitiveDenotations

export interface Primitive<Name extends PrimitiveName = PrimitiveName> extends
  TypeExpr<
    PrimitiveDenotations[Name]
  >
{
  readonly tag: "primitive"
  readonly name: Name
}

export type StringType = Primitive<"string">
export type NumberType = Primitive<"number">
export type BooleanType = Primitive<"boolean">
export type UndefinedType = Primitive<"undefined">
export type Null = Primitive<"null">
export type VoidType = Primitive<"void">
export type NeverType = Primitive<"never">
export type UnknownType = Primitive<"unknown">
export type AnyType = Primitive<"any">

export const String = (): StringType => makeTypeNode({ tag: "primitive", name: "string" })

export const Number = (): NumberType => makeTypeNode({ tag: "primitive", name: "number" })

export const Boolean = (): BooleanType => makeTypeNode({ tag: "primitive", name: "boolean" })

export const Undefined = (): UndefinedType => makeTypeNode({ tag: "primitive", name: "undefined" })

export const Null = (): Null => makeTypeNode({ tag: "primitive", name: "null" })

export const Void = (): VoidType => makeTypeNode({ tag: "primitive", name: "void" })

export const Never = (): NeverType => makeTypeNode({ tag: "primitive", name: "never" })

export const Unknown = (): UnknownType => makeTypeNode({ tag: "primitive", name: "unknown" })

export const Any = (): AnyType => makeTypeNode({ tag: "primitive", name: "any" })
