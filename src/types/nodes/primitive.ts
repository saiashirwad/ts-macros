import { makePipeable } from "../../pipeable.ts"
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

export const String = (): StringType => makePipeable({ tag: "primitive", name: "string" })

export const Number = (): NumberType => makePipeable({ tag: "primitive", name: "number" })

export const Boolean = (): BooleanType => makePipeable({ tag: "primitive", name: "boolean" })

export const Undefined = (): UndefinedType => makePipeable({ tag: "primitive", name: "undefined" })

export const Null = (): Null => makePipeable({ tag: "primitive", name: "null" })

export const Void = (): VoidType => makePipeable({ tag: "primitive", name: "void" })

export const Never = (): NeverType => makePipeable({ tag: "primitive", name: "never" })

export const Unknown = (): UnknownType => makePipeable({ tag: "primitive", name: "unknown" })

export const Any = (): AnyType => makePipeable({ tag: "primitive", name: "any" })
