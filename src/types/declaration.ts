import { Builder, makeStatement } from "../node.ts"
import type { Declared, TypeExpr } from "./core.ts"
import { type AnyParams, Ref, type TypeRef } from "./nodes.ts"

export interface TypeDeclaration<Body = unknown, Params extends AnyParams = []> {
  readonly tag: "type-declaration"
  readonly name: string
  readonly params: Params
  readonly body: TypeExpr<Body>
}

export class TypeBuilder<Body = unknown, Params extends AnyParams = []> extends Builder {
  readonly declaration: TypeDeclaration<Body, Params>

  constructor(declaration: TypeDeclaration<Body, Params>) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<TypeDeclaration<Body, Params>, TypeRef<Declared<Params, Body>>, unknown> {
    yield makeStatement(this.declaration)
    return Ref(this.declaration.name)
  }
}

/** `type name = body`; pipe through `TypeParams` to make it `type name<T> = body` */
export const Type = <Body>(name: string, body: TypeExpr<Body>): TypeBuilder<Body, []> =>
  new TypeBuilder({ tag: "type-declaration", name, params: [], body })

export const TypeParams = <const Params extends AnyParams>(...params: Params) => <Body>(builder: TypeBuilder<Body, any>): TypeBuilder<Body, Params> =>
  new TypeBuilder({ ...builder.declaration, params })
