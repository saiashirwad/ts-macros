import * as t from "@babel/types"

import { normalizeToExpression } from "./infer.ts"
import type { Expression, TSTypeDescriptor } from "./ir.ts"
import { brand } from "./ir.ts"
import type {
  CallArgs,
  ClassRefMeta,
  ClassConstructorOf,
  ClassInstanceOf,
  InferTSType,
  TypedExpression,
} from "./types.ts"
import { ClassRefCtorMeta, ClassRefInstanceMeta, typedExpr } from "./types.ts"

export class TypeRef<T = unknown> {
  declare readonly _tag: "TypeRef"
  declare readonly __type: T

  name: string
  descriptor: TSTypeDescriptor
  resolved?: TSTypeDescriptor | undefined

  constructor(
    name: string,
    descriptor: TSTypeDescriptor,
    resolved?: TSTypeDescriptor | undefined,
  ) {
    this.name = name
    this.descriptor = descriptor
    if (resolved !== undefined) this.resolved = resolved
  }

  toDescriptor(): TSTypeDescriptor & { __phantom: T } {
    const resolved = this.resolved ?? (this.descriptor as any).resolved
    return {
      ...(this.descriptor as any),
      resolved,
      __phantom: undefined as T,
    }
  }

  toBabel(): t.TSTypeReference {
    return t.tsTypeReference(t.identifier(this.name))
  }

  toString(): string {
    return this.name
  }
}

export class VarRef<T = unknown> {
  declare readonly _tag: "VarRef"
  declare readonly __type: T

  name: string
  tsType?: TSTypeDescriptor | string | undefined

  constructor(
    name: string,
    tsType?: TSTypeDescriptor | string | undefined,
  ) {
    this.name = name
    if (tsType !== undefined) this.tsType = tsType
  }

  toBabel(): t.Identifier {
    const id = t.identifier(this.name)
    return id
  }

  toString(): string {
    return this.name
  }
}

export class ClassMemberRef<T = unknown> extends VarRef<T> {
  declare readonly __classMember: true

  memberKey: string
  options?: {
    kind?: "property" | "method" | "constructor" | "get" | "set" | undefined
    static?: boolean | undefined
    accessibility?: "public" | "private" | "protected" | undefined
  }

  constructor(
    name: string,
    memberKey: string,
    tsType?: TSTypeDescriptor | string,
    options?: {
      kind?: "property" | "method" | "constructor" | "get" | "set" | undefined
      static?: boolean | undefined
      accessibility?: "public" | "private" | "protected" | undefined
    },
  ) {
    super(name, tsType)
    this.memberKey = memberKey
    if (options !== undefined) this.options = options
  }
}

export class ClassRef<Host = unknown> extends VarRef<any> {
  declare readonly [ClassRefCtorMeta]: () => Host
  declare readonly [ClassRefInstanceMeta]: Host

  instanceTsType?: TSTypeDescriptor | string
  ctorTsType?: TSTypeDescriptor | string

  constructor(
    name: string,
    instanceTsType?: TSTypeDescriptor | string,
    ctorTsType?: TSTypeDescriptor | string,
  ) {
    super(name, ctorTsType)
    if (instanceTsType !== undefined) this.instanceTsType = instanceTsType
    if (ctorTsType !== undefined) this.ctorTsType = ctorTsType
  }

  get meta(): ClassRefMeta<ClassRef<Host>> {
    return this as unknown as ClassRefMeta<ClassRef<Host>>
  }

  new<Self extends ClassRef<Host>>(
    this: Self,
    ...args: CallArgs<Parameters<ClassConstructorOf<Self>>>
  ): TypedExpression<ClassInstanceOf<Self>> {
    const argsExpr = (args as unknown[]).map((arg) => normalizeToExpression(arg))
    const expr: Expression = brand({
      type: "new",
      callee: brand({ type: "variable", name: this.name }),
      arguments: argsExpr,
      typeArguments: undefined,
    })
    return typedExpr<ClassInstanceOf<Self>>(
      expr,
      typeof this.instanceTsType === "string" ? undefined : this.instanceTsType,
    )
  }
}

export function createTypedVarRef<T extends TSTypeDescriptor>(
  name: string,
  typeDesc: T,
): VarRef<InferTSType<T>> {
  return new VarRef(name, typeDesc) as VarRef<InferTSType<T>>
}
