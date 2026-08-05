import type * as Expr from "./expr.ts"
import { Class as PipeableClass, makePipeable } from "./pipeable.ts"
import type * as Program from "./program.ts"
import type * as Type from "./type.ts"

export interface LetDecl extends Program.Declaration {
  readonly tag: "let-decl"
  readonly name: string
  readonly init?: Expr.Expr<any>
  readonly annotation?: Type.TypeExpr<any>
}

export interface LetSpec {
  readonly name: string
  readonly init?: Expr.Expr<any>
  readonly annotation?: Type.TypeExpr<any>
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

  *[Symbol.iterator](): Generator<LetDecl, Expr.VarRef<A>, unknown> {
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
  <A>(expr: Expr.Expr<A>): LetTransform<A> =>
  <B>(builder: LetBuilder<B>) =>
    builder.withSpec<B & A>({
      ...builder.spec,
      init: expr,
    })

export const annotate =
  <A>(annotation: Type.TypeExpr<A>): LetTransform<A> =>
  <B>(builder: LetBuilder<B>) =>
    builder.withSpec<B & A>({
      ...builder.spec,
      annotation,
    })
