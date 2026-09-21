import { Builder, isType, makeStatement } from "../node.ts"
import type { Declared, Type } from "./core.ts"
import { type AnyParams, type CheckTypeParamNames, type Param, ref, type TypeRef } from "./nodes.ts"

/** `type Name = body`, or `type Name<params> = body` */
export interface TypeDeclaration<Body = unknown, Params extends AnyParams = []> {
  readonly kind: "type-declaration"
  readonly name: string
  readonly params: Params
  readonly body: Type<Body>
}

export class TypeBuilder<Body = unknown, Params extends AnyParams = []> extends Builder {
  readonly declaration: TypeDeclaration<Body, Params>

  constructor(declaration: TypeDeclaration<Body, Params>) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<TypeDeclaration<Body, Params>, TypeRef<Declared<Params, Body>>, unknown> {
    yield makeStatement(this.declaration)
    return ref(this.declaration.name)
  }
}

export interface TypeAlias<Body, Params extends AnyParams = []> {
  readonly params: Params
  readonly body: Type<Body>
}

type CheckedAlias<Body, Params extends AnyParams> =
  & TypeAlias<Body, Params>
  & (CheckTypeParamNames<Params> extends unknown[] ? CheckTypeParamNames<Params> : unknown)

/** `type name = body`, or `type name<T> = body` when `params` is given */
export function type_<Body>(name: string, body: Type<Body>): TypeBuilder<Body, []>
export function type_<Body, const Params extends AnyParams>(name: string, spec: CheckedAlias<Body, Params>): TypeBuilder<Body, Params>
export function type_<Body>(name: string, bodyOrSpec: Type<Body> | TypeAlias<Body, AnyParams>): TypeBuilder<Body, AnyParams> {
  if (isType(bodyOrSpec)) return new TypeBuilder({ kind: "type-declaration", name, params: [], body: bodyOrSpec })
  return new TypeBuilder({ kind: "type-declaration", name, params: bodyOrSpec.params, body: bodyOrSpec.body })
}

export type { Param }
