/** `builder.pipe(f, g)` is `g(f(builder))` */
export interface Pipeable {
  pipe<A>(this: A): A
  pipe<A, B = never>(this: A, ab: (_: A) => B): B
  pipe<A, B = never, C = never>(this: A, ab: (_: A) => B, bc: (_: B) => C): C
  pipe<A, B = never, C = never, D = never>(
    this: A,
    ab: (_: A) => B,
    bc: (_: B) => C,
    cd: (_: C) => D,
  ): D
  pipe<A, B = never, C = never, D = never, E = never>(
    this: A,
    ab: (_: A) => B,
    bc: (_: B) => C,
    cd: (_: C) => D,
    de: (_: D) => E,
  ): E
  pipe<A, B = never, C = never, D = never, E = never, F = never>(
    this: A,
    ab: (_: A) => B,
    bc: (_: B) => C,
    cd: (_: C) => D,
    de: (_: D) => E,
    ef: (_: E) => F,
  ): F
  pipe<A, B = never, C = never, D = never, E = never, F = never, G = never>(
    this: A,
    ab: (_: A) => B,
    bc: (_: B) => C,
    cd: (_: C) => D,
    de: (_: D) => E,
    ef: (_: E) => F,
    fg: (_: F) => G,
  ): G
  pipe<A, B = never, C = never, D = never, E = never, F = never, G = never, H = never>(
    this: A,
    ab: (_: A) => B,
    bc: (_: B) => C,
    cd: (_: C) => D,
    de: (_: D) => E,
    ef: (_: E) => F,
    fg: (_: F) => G,
    gh: (_: G) => H,
  ): H
}

/** base of a control-flow builder (`if_`, `while_`, `forOf`); a builder pipes, a node does not */
export class Builder {
  declare readonly pipe: Pipeable["pipe"]
}
Object.defineProperty(Builder.prototype, "pipe", {
  value(this: unknown, ...fns: Array<(a: unknown) => unknown>) {
    return fns.reduce((value, fn) => fn(value), this)
  },
})

const NodeBrand = Symbol.for("ts-macros.node")
const TypeBrand = Symbol.for("ts-macros.type")

declare const TypeId: unique symbol

/** an expression, statement, parameter, or block */
export interface Node {
  readonly [NodeBrand]: true
  readonly kind: string
}

/**
 * A syntax node that denotes a type. `A` is the TypeScript type it stands for.
 * The brand is what tells it from a value node, so a walk of the program does
 * not enter annotations.
 */
export interface Type<A = unknown> extends Node {
  readonly [TypeBrand]: true
  readonly [TypeId]?: A
}

/** a statement that yields itself, so `yield* statement` appends it to the current block */
export interface Yieldable extends Node {
  [Symbol.iterator](): Generator<this, void, unknown>
}

const NodePrototype = { [NodeBrand]: true as const }
const TypePrototype = Object.assign(Object.create(NodePrototype), { [TypeBrand]: true as const })
const StatementPrototype = Object.assign(Object.create(NodePrototype), {
  *[Symbol.iterator]() {
    yield this
  },
})

const branded = (value: unknown, brand: symbol): boolean =>
  value !== null && typeof value === "object" && (value as { readonly [key: symbol]: unknown })[brand] === true

export const isNode = (value: unknown): value is Node => branded(value, NodeBrand)

export const isType = (value: unknown): value is Type => branded(value, TypeBrand)

// The only three ways a node comes into existence. Every node is a plain
// immutable record over one of these prototypes; a pass that changes a node
// makes a new one.

export const makeNode = <A extends { readonly kind: string }>(value: A): A & Node => Object.assign(Object.create(NodePrototype), value)

export const makeStatement = <A extends { readonly kind: string }>(value: A): A & Yieldable => Object.assign(Object.create(StatementPrototype), value)

export const makeType = <A extends { readonly kind: string }>(value: A): A & Type<any> => Object.assign(Object.create(TypePrototype), value)
