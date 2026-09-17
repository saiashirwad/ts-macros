import * as Expr from "./expr.ts"
import { type BindingId, freshBindingId, type ValueBinding } from "./identity.ts"
import { Builder, makeStatement } from "./node.ts"
import type * as Type from "./types/index.ts"
import { bindingType, type ConstType, type IsFresh, isFresh, type WidenFresh } from "./types/lattice.ts"

export type BindingKind = "let" | "const"

export interface BindingDeclaration extends ValueBinding {
  readonly tag: "let-declaration" | "const-declaration"
  readonly id: BindingId
  readonly nameHint: string
  readonly expr?: Expr.Expr<any> | undefined
  readonly annotation?: Type.TypeExpr<any> | undefined
  /** the binding's type: the annotation, or what the initializer infers to */
  readonly type?: Type.TypeExpr<any> | undefined
}

type Mutability<Kind extends BindingKind> = Kind extends "let" ? true : false

declare const UnannotatedId: unique symbol

/** the annotation of a draft that has none */
interface Unannotated {
  readonly [UnannotatedId]: true
}

// A declaration is built in two stages, in the order TypeScript writes it:
// `let name: Annotation = initializer`. `Let(name)` and `Const(name)` are
// drafts, which take an `Annotate` and cannot be yielded. `Init` ends the
// draft, checking the initializer against the annotation; `Declare` ends a
// `let` that has no initializer.

export class BindingDraft<Annotation = Unannotated, Kind extends BindingKind = "let"> extends Builder {
  declare readonly stage: "draft"
  declare readonly annotated: Annotation
  declare readonly kind: Kind
  readonly declaration: BindingDeclaration

  constructor(declaration: BindingDeclaration) {
    super()
    this.declaration = declaration
  }
}

export class BindingBuilder<A = unknown, Kind extends BindingKind = "let", Fresh extends boolean = false> extends Builder {
  declare readonly stage: "declared"
  readonly declaration: BindingDeclaration

  constructor(declaration: BindingDeclaration) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<BindingDeclaration, Expr.VarRef<A, Mutability<Kind>, Fresh>, unknown> {
    const { annotation, expr, id, nameHint, tag, type } = this.declaration
    yield makeStatement(this.declaration)
    const fresh = tag === "const-declaration" && annotation === undefined && expr !== undefined && isFresh(expr)
    return Expr.VarRef(id, nameHint, type, (tag === "let-declaration") as Mutability<Kind>, fresh as Fresh)
  }
}

export const Let = (nameHint: string): BindingDraft<Unannotated, "let"> =>
  new BindingDraft({ tag: "let-declaration", id: freshBindingId(), nameHint })

export const Const = (nameHint: string): BindingDraft<Unannotated, "const"> =>
  new BindingDraft({ tag: "const-declaration", id: freshBindingId(), nameHint })

export const Annotate =
  <A>(annotation: Type.TypeExpr<A>) => <Kind extends BindingKind>(draft: BindingDraft<Unannotated, Kind>): BindingDraft<A, Kind> =>
    new BindingDraft({ ...draft.declaration, annotation, type: annotation })

/** the type the binding's ref denotes: the annotation, or what the initializer `E` infers to */
type Declared<Annotation, Kind extends BindingKind, E> = [Annotation] extends [Unannotated] ? (Kind extends "const" ? ConstType<E> : WidenFresh<E>)
  : Annotation

/** an unannotated `const` passes its initializer's freshness on to whoever reads it */
type RefFresh<Annotation, Kind extends BindingKind, E> = [Annotation] extends [Unannotated] ? (Kind extends "const" ? IsFresh<E> : false) : false

// A check on a pipe step is an intersection on the draft it takes, so that a
// draft it does not fit is not assignable. A `..._check` rest parameter is not
// enough here: a step held in a variable is a generic function, and
// TypeScript unifies it with `pipe`'s callback without counting parameters.
type CheckInit<Annotation, A> =
    [Annotation] extends [Unannotated] ? unknown
  : [A] extends [Annotation] ? unknown
  : ["the initializer", A, "is not assignable to the annotation", Annotation]

export const Init = <E extends Expr.Expr<any>>(expr: E) =>
<Annotation, Kind extends BindingKind>(
  draft: BindingDraft<Annotation, Kind> & CheckInit<Annotation, Expr.Denotes<E>>,
): BindingBuilder<Declared<Annotation, Kind, E>, Kind, RefFresh<Annotation, Kind, E>> => {
  const { tag, annotation } = draft.declaration
  return new BindingBuilder({ ...draft.declaration, expr, type: bindingType(tag, annotation, expr) })
}

/** `let name: A` with no initializer; a `const` has to have one */
export const Declare = <A>(annotation: Type.TypeExpr<A>) => (draft: BindingDraft<Unannotated, "let">): BindingBuilder<A, "let"> =>
  new BindingBuilder({ ...draft.declaration, annotation, type: annotation })
