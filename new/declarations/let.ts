import type { Declaration } from "../foundation/declaration";
import type { Expr } from "../foundation/expr";
import type { TypeExpr } from "../foundation/type-expr";
import { Class as PipeableClass } from "../pipeable";
import { makeVarRef } from "../refs/var-ref";
import type { VarRef } from "../refs/var-ref";

export interface LetDecl extends Declaration {
  readonly _tag: "let-decl";
  readonly name: string;
  readonly init?: Expr<any>;
  readonly annotation?: TypeExpr<any>;
}

export interface LetSpec {
  readonly name: string;
  readonly init?: Expr<any>;
  readonly annotation?: TypeExpr<any>;
}

export interface LetTransform<A = unknown> {
  <B>(builder: LetBuilder<B>): LetBuilder<B & A>;
}

export class LetBuilder<A = unknown> extends PipeableClass() {
  constructor(readonly spec: LetSpec) {
    super();
  }

  withSpec<B>(spec: LetSpec): LetBuilder<B> {
    return new LetBuilder(spec);
  }

  *[Symbol.iterator](): Generator<LetDecl, VarRef<A>, unknown> {
    yield {
      _tag: "let-decl",
      name: this.spec.name,
      init: this.spec.init,
      annotation: this.spec.annotation,
    };

    return makeVarRef<A>(this.spec.name);
  }
}

export const let_ = (name: string): LetBuilder<unknown> => new LetBuilder({ name });

export const init =
  <A>(expr: Expr<A>): LetTransform<A> =>
  <B>(builder: LetBuilder<B>) =>
    builder.withSpec<B & A>({
      ...builder.spec,
      init: expr,
    });

export const annotate =
  <A>(annotation: TypeExpr<A>): LetTransform<A> =>
  <B>(builder: LetBuilder<B>) =>
    builder.withSpec<B & A>({
      ...builder.spec,
      annotation,
    });
