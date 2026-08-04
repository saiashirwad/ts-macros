import type { Declaration } from "../foundation/declaration.ts"
import type { Expr } from "../foundation/expr.ts"
import type { TypeExpr } from "../foundation/type-expr.ts"
import { makePipeable, Class as PipeableClass } from "../pipeable.ts"
import type { VarRef } from "../refs/var-ref.ts"

export interface LetDecl extends Declaration {
  readonly tag: "let-decl"
  readonly name: string
  readonly init?: Expr<any>
  readonly annotation?: TypeExpr<any>
}

export interface LetSpec {
  readonly name: string
  readonly init?: Expr<any>
  readonly annotation?: TypeExpr<any>
}

export interface LetTransform<A = unknown> {
  <B>(builder: LetBuilder<B>): LetBuilder<B & A>
}

export class LetBuilder<A = unknown> extends PipeableClass() {
  readonly spec: LetSpec

  constructor(spec: LetSpec) {
    super()
    this.spec = spec
  }

  withSpec<B>(spec: LetSpec): LetBuilder<B> {
    return new LetBuilder(spec)
  }

  *[Symbol.iterator](): Generator<LetDecl, VarRef<A>, unknown> {
    yield {
      tag: "let-decl",
      name: this.spec.name,
      ...(this.spec.init === undefined ? {} : { init: this.spec.init }),
      ...(this.spec.annotation === undefined ? {} : { annotation: this.spec.annotation }),
    }

    return makePipeable({ tag: "var-ref", name: this.spec.name })
  }
}

export const let_ = (name: string): LetBuilder<unknown> => new LetBuilder({ name })

export const init =
  <A>(expr: Expr<A>): LetTransform<A> =>
  <B>(builder: LetBuilder<B>) =>
    builder.withSpec<B & A>({
      ...builder.spec,
      init: expr,
    })

export const annotate =
  <A>(annotation: TypeExpr<A>): LetTransform<A> =>
  <B>(builder: LetBuilder<B>) =>
    builder.withSpec<B & A>({
      ...builder.spec,
      annotation,
    })
