import { makeTypeNode, makeYieldable, PipeableClass } from "../pipeable.ts"
import type { StatementScopeHandlers } from "../scope/protocol.ts"
import type { AnyParams, Declared, TypeExpr } from "./core.ts"
import type { TypeRef } from "./nodes/ref.ts"

export interface TypeDeclaration<Body = unknown, Params extends AnyParams = []> {
  readonly tag: "type-declaration"
  readonly name: string
  readonly params: Params
  readonly body?: TypeExpr<Body>
}

export class TypeBuilder<Body = unknown, Params extends AnyParams = []> extends PipeableClass() {
  readonly declaration: TypeDeclaration<Body, Params>

  constructor(declaration: TypeDeclaration<Body, Params>) {
    super()
    this.declaration = declaration
  }

  withDeclaration<Body, Params extends AnyParams>(declaration: TypeDeclaration<Body, Params>) {
    return new TypeBuilder(declaration)
  }

  *[Symbol.iterator](): Generator<
    TypeDeclaration<Body, Params>,
    TypeRef<Declared<Params, Body>>,
    unknown
  > {
    const { name, params, body } = this.declaration
    yield makeYieldable(
      body === undefined
        ? { tag: "type-declaration", name, params }
        : { tag: "type-declaration", name, params, body },
    )

    return makeTypeNode({ tag: "type-ref", name: this.declaration.name })
  }
}

export const Type = (name: string): TypeBuilder<unknown, []> => new TypeBuilder({ tag: "type-declaration", name, params: [] })

export const Body = <Body>(body: TypeExpr<Body>) => <Params extends AnyParams>(builder: TypeBuilder<any, Params>) =>
  builder.withDeclaration({ ...builder.declaration, body })

export const TypeParams = <const Params extends AnyParams>(...params: Params) => <Body>(builder: TypeBuilder<Body, any>) =>
  builder.withDeclaration({ ...builder.declaration, params })

export const typeDeclarationScopeHandlers = {
  "type-declaration": {
    bindings: () => [],
    visit: () => {},
  },
} satisfies StatementScopeHandlers<TypeDeclaration<any, any>>
