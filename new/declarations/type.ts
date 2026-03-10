import type { Declaration } from "../foundation/declaration";
import type { TypeExpr } from "../foundation/type-expr";
import { Class as PipeableClass } from "../pipeable";
import { makeTypeRef } from "../refs/type-ref";
import type { TypeRef } from "../refs/type-ref";
import type { DeclaredType, TypeParam } from "../type-level/param";

export interface TypeDecl<
  Body = unknown,
  Params extends readonly TypeParam<string, any>[] = readonly [],
> extends Declaration {
  readonly _tag: "type-decl";
  readonly name: string;
  readonly typeParams: Params;
  readonly body?: TypeExpr<Body>;
}

export interface TypeSpec<
  Body = unknown,
  Params extends readonly TypeParam<string, any>[] = readonly [],
> {
  readonly name: string;
  readonly typeParams: Params;
  readonly body?: TypeExpr<Body>;
}

export interface TypeTransform<Body = unknown, Params extends readonly TypeParam<string, any>[] = readonly []> {
  (builder: TypeBuilder<any, any>): TypeBuilder<Body, Params>;
}

export class TypeBuilder<
  Body = unknown,
  Params extends readonly TypeParam<string, any>[] = readonly [],
> extends PipeableClass() {
  constructor(readonly spec: TypeSpec<Body, Params>) {
    super();
  }

  withSpec<NextBody, NextParams extends readonly TypeParam<string, any>[]>(
    spec: TypeSpec<NextBody, NextParams>,
  ): TypeBuilder<NextBody, NextParams> {
    return new TypeBuilder(spec);
  }

  *[Symbol.iterator](): Generator<
    TypeDecl<Body, Params>,
    TypeRef<DeclaredType<Params, Body>>,
    unknown
  > {
    yield {
      _tag: "type-decl",
      name: this.spec.name,
      typeParams: this.spec.typeParams,
      body: this.spec.body,
    };

    return makeTypeRef<DeclaredType<Params, Body>>(this.spec.name);
  }
}

export const type_ = (name: string): TypeBuilder<unknown, readonly []> =>
  new TypeBuilder({
    name,
    typeParams: [],
  });

export const body = <Body>(typeExpr: TypeExpr<Body>) =>
  <Params extends readonly TypeParam<string, any>[]>(
    builder: TypeBuilder<any, Params>,
  ): TypeBuilder<Body, Params> =>
    builder.withSpec<Body, Params>({
      ...builder.spec,
      body: typeExpr,
    });

export const typeParams = <const Params extends readonly TypeParam<string, any>[]>(
  ...nextTypeParams: Params
) =>
  <Body>(builder: TypeBuilder<Body, any>): TypeBuilder<Body, Params> =>
    builder.withSpec<Body, Params>({
      ...builder.spec,
      typeParams: nextTypeParams,
    });
