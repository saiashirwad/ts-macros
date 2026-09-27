import { type CheckLift, type Expr, type Lift, lift, type Ref, ref, type Value } from "./expr.ts"
import { type BindingId, freshBindingId, type ValueBinding } from "./identity.ts"
import { Builder, isType, makeStatement } from "./node.ts"
import type * as Type from "./types/index.ts"
import { bindingType, type ConstType, type IsFresh, isFresh, type WidenFresh } from "./typing.ts"

export type BindingKind = "let" | "const"

export interface BindingDeclaration extends ValueBinding {
  readonly kind: "let-declaration" | "const-declaration"
  readonly id: BindingId
  readonly nameHint: string
  readonly expr?: Expr<any> | undefined
  readonly annotation?: Type.Type<any> | undefined
  /** the binding's type: the annotation, or what the initializer infers to */
  readonly type?: Type.Type<any> | undefined
}

type Mutability<Kind extends BindingKind> = Kind extends "let" ? true : false

/** a `let` or `const` that yields its declaration and hands back a reference */
export class BindingBuilder<A = unknown, Kind extends BindingKind = "let", Fresh extends boolean = false> extends Builder {
  readonly declaration: BindingDeclaration

  constructor(declaration: BindingDeclaration) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<BindingDeclaration, Ref<A, Mutability<Kind>, Fresh>, unknown> {
    const { annotation, expr, id, nameHint, kind, type } = this.declaration
    yield makeStatement(this.declaration)
    const fresh = kind === "const-declaration" && annotation === undefined && expr !== undefined && isFresh(expr)
    return ref(id, nameHint, type, (kind === "let-declaration") as Mutability<Kind>, fresh as Fresh)
  }
}

type CheckInit<Annotation, A> = [A] extends [Annotation] ? unknown : ["the initializer", A, "is not assignable to the annotation", Annotation]

const declare = (
  kind: BindingDeclaration["kind"],
  nameHint: string,
  expr: Expr<any> | undefined,
  annotation: Type.Type<any> | undefined,
): BindingBuilder<any, any, any> =>
  new BindingBuilder({
    kind,
    id: freshBindingId(),
    nameHint,
    expr,
    annotation,
    type: annotation ?? (expr === undefined ? undefined : bindingType(kind, undefined, expr)),
  })

/**
 * `let name = init`, `let name: annotation = init`, or `let name: annotation`.
 * A lone type node is a declaration with no initializer.
 */
export function let_<A>(name: string, annotation: Type.Type<A>): BindingBuilder<A, "let", false>
export function let_<const E>(name: string, init: E, ..._check: CheckLift<E>): BindingBuilder<WidenFresh<Lift<E>>, "let", false>
export function let_<A, const E>(
  name: string,
  init: E,
  annotation: Type.Type<A>,
  ..._check: [...CheckLift<E>, ...(CheckInit<A, Value<E>> extends unknown[] ? CheckInit<A, Value<E>> : [])]
): BindingBuilder<A, "let", false>
export function let_(name: string, initOrAnnotation: unknown, annotation?: unknown): BindingBuilder<any, "let", false> {
  if (annotation === undefined && isType(initOrAnnotation)) return declare("let-declaration", name, undefined, initOrAnnotation)
  const expr = lift(initOrAnnotation as never)
  const note = annotation as Type.Type<any> | undefined
  return declare("let-declaration", name, expr, note)
}

/** `const name = init`, or `const name: annotation = init` */
export function const_<const E>(
  name: string,
  init: E,
  ..._check: CheckLift<E>
): BindingBuilder<ConstType<Lift<E>>, "const", IsFresh<Lift<E>>>
export function const_<A, const E>(
  name: string,
  init: E,
  annotation: Type.Type<A>,
  ..._check: [...CheckLift<E>, ...(CheckInit<A, Value<E>> extends unknown[] ? CheckInit<A, Value<E>> : [])]
): BindingBuilder<A, "const", false>
export function const_(name: string, init: unknown, annotation?: unknown): BindingBuilder<any, "const", any> {
  return declare("const-declaration", name, lift(init as never), annotation as Type.Type<any> | undefined)
}
