import * as Expr from "./expr.ts"
import { type BindingId, freshBindingId, type ValueBinding } from "./identity.ts"
import { makeYieldable, PipeableClass } from "./pipeable.ts"
import type { StatementScopeBehavior, StatementScopeHandlers } from "./scope/protocol.ts"
import type * as Type from "./types/index.ts"

export type BindingKind = "let" | "const"

export interface BindingDeclaration extends ValueBinding {
  readonly tag: "let-declaration" | "const-declaration"
  readonly id: BindingId
  readonly nameHint: string
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
    const { expr, nameHint, tag } = this.declaration
    if (tag === "const-declaration" && expr === undefined) {
      throw new Error(`const "${nameHint}" requires an initializer`)
    }
    yield makeYieldable(this.declaration)
    return Expr.LocalRef<A, Mutability<Kind>>(this.declaration.id, nameHint)
  }
}

export const Let = (nameHint: string): BindingBuilder<unknown, "let"> =>
  new BindingBuilder({ tag: "let-declaration", id: freshBindingId(), nameHint })

export const Const = (nameHint: string): BindingBuilder<unknown, "const"> =>
  new BindingBuilder({ tag: "const-declaration", id: freshBindingId(), nameHint })

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

const bindingScopeBehavior: StatementScopeBehavior<BindingDeclaration> = {
  bindings: (node) => [node],
  visit: (node, cursor) => {
    if (node.expr !== undefined) cursor.expression(node.expr)
  },
}

export const bindingScopeHandlers = {
  "let-declaration": bindingScopeBehavior,
  "const-declaration": bindingScopeBehavior,
} satisfies StatementScopeHandlers<BindingDeclaration>
