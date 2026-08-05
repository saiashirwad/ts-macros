import type { Declaration } from "../foundation/declaration.ts"
import type { TypeExpr } from "../foundation/type-expr.ts"
import { makePipeable, Class as PipeableClass } from "../pipeable.ts"
import type { TypeRef } from "../refs/type-ref.ts"
import * as Type from "../type.ts"

export interface TypeDecl<
  Body = unknown,
  Params extends Type.Param<string, any>[] = [],
> extends Declaration {
  readonly tag: "type-decl"
  readonly name: string
  readonly typeParams: Params
  readonly body?: TypeExpr<Body>
}

export interface TypeSpec<Body = unknown, Params extends readonly Type.Param<string, any>[] = []> {
  readonly name: string
  readonly typeParams: Params
  readonly body?: TypeExpr<Body>
}

export interface TypeTransform<Body = unknown, Params extends Type.Param<string, any>[] = []> {
  (builder: TypeBuilder<any, any>): TypeBuilder<Body, Params>
}

export class TypeBuilder<
  Body = unknown,
  Params extends Type.Param<string, any>[] = [],
> extends PipeableClass() {
  readonly spec: TypeSpec<Body, Params>

  constructor(spec: TypeSpec<Body, Params>) {
    super()
    this.spec = spec
  }

  withSpec<NextBody, NextParams extends Type.Param<string, any>[]>(
    spec: TypeSpec<NextBody, NextParams>,
  ): TypeBuilder<NextBody, NextParams> {
    return new TypeBuilder(spec)
  }

  *[Symbol.iterator](): Generator<
    TypeDecl<Body, Params>,
    TypeRef<Type.Declared<Params, Body>>,
    unknown
  > {
    yield {
      tag: "type-decl",
      name: this.spec.name,
      typeParams: this.spec.typeParams,
      ...(this.spec.body === undefined ? {} : { body: this.spec.body }),
    }

    return makePipeable({ tag: "type-ref", name: this.spec.name })
  }
}

export const type_ = (name: string): TypeBuilder<unknown, []> =>
  new TypeBuilder({
    name,
    typeParams: [],
  })

export const body =
  <Body>(typeExpr: TypeExpr<Body>) =>
  <Params extends Type.Param<string, any>[]>(
    builder: TypeBuilder<any, Params>,
  ): TypeBuilder<Body, Params> =>
    builder.withSpec<Body, Params>({
      ...builder.spec,
      body: typeExpr,
    })

export const typeParams =
  <const Params extends Type.Param<string, any>[]>(...nextTypeParams: Params) =>
  <Body>(builder: TypeBuilder<Body, any>): TypeBuilder<Body, Params> =>
    builder.withSpec<Body, Params>({
      ...builder.spec,
      typeParams: nextTypeParams,
    })
