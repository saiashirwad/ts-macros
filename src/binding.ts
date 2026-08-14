import type * as Expr from "./expr.ts"
import { type CheckLift, type Denote, type In, norm } from "./norm.ts"
import { makePipeable, PipeableClass } from "./pipeable.ts"
import type * as Type from "./types/index.ts"

export type BindingKind = "let" | "const"

export interface BindingDeclaration {
  readonly tag: "binding"
  readonly kind: BindingKind
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
    const { kind, expr, name, annotation } = this.declaration
    if (kind === "const" && expr === undefined) {
      throw new Error(`const "${name}" requires an initializer`)
    }
    yield {
      tag: "binding",
      kind,
      name,
      ...(expr === undefined ? {} : { expr: expr }),
      ...(annotation === undefined ? {} : { annotation: annotation }),
    }

    return makePipeable({ tag: "var-ref", name: this.declaration.name })
  }
}

export const Let = (name: string): BindingBuilder<unknown, "let"> => new BindingBuilder({ tag: "binding", kind: "let", name })

export const Const = (name: string): BindingBuilder<unknown, "const"> => new BindingBuilder({ tag: "binding", kind: "const", name })

export const Init = <const X>(expr: X, ..._check: CheckLift<X>) => <B, Kind extends BindingKind>(builder: BindingBuilder<B, Kind>) =>
  builder.withDeclaration<B & (Kind extends "const" ? Expr.ConstWiden<Denote<X>> : Expr.Widen<Denote<X>>), Kind>({
    ...builder.declaration,
    expr: norm(expr as any),
  })

export const Annotate = <A>(annotation: Type.TypeExpr<A>) =>
<B, Kind extends BindingKind>(
  builder: BindingBuilder<B, Kind>,
): [B & A] extends [never] ? { error: "annotation contradicts initializer"; annotation: A; initializer: B } : BindingBuilder<B & A, Kind> =>
  builder.withDeclaration<B & A, Kind>({ ...builder.declaration, annotation }) as any
