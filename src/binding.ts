import type * as Expr from "./expr.ts"
import { makePipeable, makeYieldable, PipeableClass } from "./pipeable.ts"
import type * as Type from "./types/index.ts"

export type BindingKind = "let" | "const"

export interface BindingDeclaration {
  readonly tag: "let-declaration" | "const-declaration"
  readonly name: string
  readonly expr?: Expr.Expr<any>
  readonly annotation?: Type.TypeExpr<any>
}

type Mutability<Kind extends BindingKind> = Kind extends "let" ? true : false

export class BindingBuilder<A = unknown, Kind extends BindingKind = "let"> extends PipeableClass() {
  readonly declaration: BindingDeclaration

  constructor(declaration: BindingDeclaration) {
    super()
    this.declaration = declaration
  }

  withDeclaration<B, K extends BindingKind>(declaration: BindingDeclaration): BindingBuilder<B, K> {
    return new BindingBuilder(declaration)
  }

  *[Symbol.iterator](): Generator<BindingDeclaration, Expr.VarRef<A, Mutability<Kind>>, unknown> {
    const { tag, expr, name, annotation } = this.declaration
    if (tag === "const-declaration" && expr === undefined) {
      throw new Error(`const "${name}" requires an initializer`)
    }
    yield makeYieldable({
      tag,
      name,
      ...(expr === undefined ? {} : { expr: expr }),
      ...(annotation === undefined ? {} : { annotation: annotation }),
    })

    return makePipeable({ tag: "var-ref", name: this.declaration.name })
  }
}

export const Let = (name: string): BindingBuilder<unknown, "let"> => new BindingBuilder({ tag: "let-declaration", name })

export const Const = (name: string): BindingBuilder<unknown, "const"> => new BindingBuilder({ tag: "const-declaration", name })

/** let widens literal initializers (so reassignment works); const keeps them */
export const Init = <A>(expr: Expr.Expr<A>) => <B, Kind extends BindingKind>(builder: BindingBuilder<B, Kind>) =>
  builder.withDeclaration<B & (Kind extends "const" ? Expr.ConstWiden<A> : Expr.Widen<A>), Kind>({
    ...builder.declaration,
    expr,
  })

export const Annotate = <A>(annotation: Type.TypeExpr<A>) =>
<B, Kind extends BindingKind>(
  builder: BindingBuilder<B, Kind>,
): [B & A] extends [never] ? { error: "annotation contradicts initializer"; annotation: A; initializer: B } : BindingBuilder<B & A, Kind> =>
  builder.withDeclaration<B & A, Kind>({ ...builder.declaration, annotation }) as any
