import { PipeableClass, makePipeable } from "./pipeable.ts"
import type * as Type from "./type.ts"

export interface TypeDeclaration<Body = unknown, Params extends Type.AnyParams = []> {
  readonly tag: "type-declaration"
  readonly name: string
  readonly params: Params
  readonly body?: Type.TypeExpr<Body>
}

export class TypeBuilder<
  Body = unknown,
  Params extends Type.AnyParams = [],
> extends PipeableClass() {
  readonly spec: TypeDeclaration<Body, Params>

  constructor(spec: TypeDeclaration<Body, Params>) {
    super()
    this.spec = spec
  }

  withSpec<Body, Params extends Type.AnyParams>(spec: TypeDeclaration<Body, Params>) {
    return new TypeBuilder(spec)
  }

  *[Symbol.iterator](): Generator<
    TypeDeclaration<Body, Params>,
    Type.TypeRef<Type.Declared<Params, Body>>,
    unknown
  > {
    yield {
      tag: "type-declaration",
      name: this.spec.name,
      params: this.spec.params,
      ...(this.spec.body === undefined ? {} : { body: this.spec.body }),
    }

    return makePipeable({ tag: "type-ref", name: this.spec.name })
  }
}

export const Build = (name: string): TypeBuilder<unknown, []> =>
  new TypeBuilder({ tag: "type-declaration", name, params: [] })

export const Body =
  <Body>(body: Type.TypeExpr<Body>) =>
  <Params extends Type.AnyParams>(builder: TypeBuilder<any, Params>) =>
    builder.withSpec<Body, Params>({ ...builder.spec, body })
