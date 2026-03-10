import type { Declaration } from "../foundation/declaration";
import type { TypeExpr } from "../foundation/type-expr";
import { Class as PipeableClass } from "../pipeable";
import { makeTypeRef } from "../refs/type-ref";
import type { TypeRef } from "../refs/type-ref";

export interface TypeDecl<A = unknown> extends Declaration {
  readonly _tag: "type-decl";
  readonly name: string;
  readonly body?: TypeExpr<A>;
}

export interface TypeSpec<A = unknown> {
  readonly name: string;
  readonly body?: TypeExpr<A>;
}

export interface TypeTransform<A = unknown> {
  (builder: TypeBuilder<any>): TypeBuilder<A>;
}

export class TypeBuilder<A = unknown> extends PipeableClass() {
  constructor(readonly spec: TypeSpec<A>) {
    super();
  }

  withSpec<B>(spec: TypeSpec<B>): TypeBuilder<B> {
    return new TypeBuilder(spec);
  }

  *[Symbol.iterator](): Generator<TypeDecl<A>, TypeRef<A>, unknown> {
    yield {
      _tag: "type-decl",
      name: this.spec.name,
      body: this.spec.body,
    };

    return makeTypeRef<A>(this.spec.name);
  }
}

export const type_ = (name: string): TypeBuilder<unknown> =>
  new TypeBuilder({
    name,
  });

export const body = <A>(typeExpr: TypeExpr<A>): TypeTransform<A> =>
  (builder: TypeBuilder<any>): TypeBuilder<A> =>
    builder.withSpec<A>({
      ...builder.spec,
      body: typeExpr,
    });
