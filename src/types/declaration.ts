import { Builder, makeStatement } from "../node.ts"
import type { Declared, TypeExpr } from "./core.ts"
import { type AnyParams, Ref, type TypeRef } from "./nodes.ts"

export interface TypeDeclaration<Body = unknown, Params extends AnyParams = []> {
  readonly tag: "type-declaration"
  readonly name: string
  readonly params: Params
  readonly body?: TypeExpr<Body> | undefined
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

export const Type = (name: string): TypeBuilder<unknown, []> => new TypeBuilder({ tag: "type-declaration", name, params: [] })

export const TypeParams = <const Params extends AnyParams>(...params: Params) => <Body>(builder: TypeBuilder<Body, any>): TypeBuilder<Body, Params> =>
  new TypeBuilder({ ...builder.declaration, params })

export const Body = <Body>(body: TypeExpr<Body>) => <Params extends AnyParams>(builder: TypeBuilder<any, Params>): TypeBuilder<Body, Params> =>
  new TypeBuilder({ ...builder.declaration, body })
