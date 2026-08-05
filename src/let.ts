import type * as Expr from "./expr.ts"
import { makePipeable, PipeableClass } from "./pipeable.ts"
import type * as Type from "./type.ts"

export interface LetDeclaration {
  readonly tag: "let-declaration"
  readonly name: string
  readonly expr?: Expr.Expr<any>
  readonly annotation?: Type.TypeExpr<any>
}

export class LetBuilder<A = unknown> extends PipeableClass() {
  readonly spec: LetDeclaration

  constructor(spec: LetDeclaration) {
    super()
    this.spec = spec
  }

  withSpec<B>(spec: LetDeclaration): LetBuilder<B> {
    return new LetBuilder(spec)
  }

  *[Symbol.iterator](): Generator<LetDeclaration, Expr.VarRef<A>, unknown> {
    yield {
      tag: "let-declaration",
      name: this.spec.name,
      ...(this.spec.expr === undefined ? {} : { expr: this.spec.expr }),
      ...(this.spec.annotation === undefined ? {} : { annotation: this.spec.annotation }),
    }

    return makePipeable({ tag: "var-ref", name: this.spec.name })
  }
}

export const Let = (name: string): LetBuilder<unknown> => new LetBuilder({ tag: "let-declaration", name })

export const Init = <A>(expr: Expr.Expr<A>) => <B>(builder: LetBuilder<B>) =>
  builder.withSpec<B & A>({ ...builder.spec, expr })

export const Annotate = <A>(annotation: Type.TypeExpr<A>) => <B>(builder: LetBuilder<B>) =>
  builder.withSpec<B & A>({ ...builder.spec, annotation })
