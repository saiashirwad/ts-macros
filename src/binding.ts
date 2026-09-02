import * as Expr from "./expr.ts"
import { type BindingId, freshBindingId, type ValueBinding } from "./identity.ts"
import { Builder, makeYieldable } from "./pipeable.ts"
import type * as Type from "./types/index.ts"
import { constWiden, widen } from "./types/lattice.ts"

export type BindingKind = "let" | "const"

export interface BindingDeclaration extends ValueBinding {
  readonly tag: "let-declaration" | "const-declaration"
  readonly id: BindingId
  readonly nameHint: string
  readonly expr?: Expr.Expr<any> | undefined
  readonly annotation?: Type.TypeExpr<any> | undefined
  /** the binding's type: the annotation, or the initializer's type widened for `let` */
  readonly type?: Type.TypeExpr<any> | undefined
}

/** the type a binding takes: its annotation wins; otherwise `let` widens the initializer's type and `const` keeps it */
export const bindingType = (
  tag: BindingDeclaration["tag"],
  annotation: Type.TypeExpr<any> | undefined,
  initializer: Type.TypeExpr<any> | undefined,
): Type.TypeExpr<any> | undefined => {
  if (annotation !== undefined) return annotation
  if (initializer === undefined) return undefined
  return tag === "let-declaration" ? widen(initializer) : constWiden(initializer)
}

type Mutability<Kind extends BindingKind> = Kind extends "let" ? true : false

export class BindingBuilder<A = unknown, Kind extends BindingKind = "let"> extends Builder {
  readonly declaration: BindingDeclaration

  constructor(declaration: BindingDeclaration) {
    super()
    this.declaration = makeYieldable(declaration)
  }

  *[Symbol.iterator](): Generator<BindingDeclaration, Expr.VarRef<A, Mutability<Kind>>, unknown> {
    const { expr, nameHint, tag, type } = this.declaration
    if (tag === "const-declaration" && expr === undefined) {
      throw new Error(`const "${nameHint}" requires an initializer`)
    }
    yield this.declaration
    return Expr.LocalRef<A, Mutability<Kind>>(this.declaration.id, nameHint, type)
  }
}

export const Let = (nameHint: string): BindingBuilder<unknown, "let"> =>
  new BindingBuilder({ tag: "let-declaration", id: freshBindingId(), nameHint })

export const Const = (nameHint: string): BindingBuilder<unknown, "const"> =>
  new BindingBuilder({ tag: "const-declaration", id: freshBindingId(), nameHint })

export const Init = <A>(expr: Expr.Expr<A>) =>
<B, Kind extends BindingKind>(builder: BindingBuilder<B, Kind>): BindingBuilder<
  & B
  & (Kind extends "const" ? Expr.ConstWiden<A> : Expr.Widen<A>),
  Kind
> => {
  const { tag, annotation } = builder.declaration
  return new BindingBuilder({ ...builder.declaration, expr, type: bindingType(tag, annotation, expr.type) })
}

export const Annotate = <A>(annotation: Type.TypeExpr<A>) =>
<B, Kind extends BindingKind>(
  builder: BindingBuilder<B, Kind>,
): [B & A] extends [never] ? { error: "annotation contradicts initializer"; annotation: A; initializer: B } : BindingBuilder<B & A, Kind> =>
  new BindingBuilder({ ...builder.declaration, annotation, type: annotation }) as any
