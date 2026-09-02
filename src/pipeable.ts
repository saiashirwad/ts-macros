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

const Prototype: Pipeable = {
  pipe(this: unknown, ...fns: Array<(a: unknown) => unknown>) {
    return fns.reduce((value, fn) => fn(value), this) as any
  },
}

/** base class for the builders (`Fn.Function(...)`, `Binding.Let(...)`): they pipe, but they are not AST nodes */
export const Builder = class {} as unknown as new() => Pipeable
Object.defineProperty(Builder.prototype, "pipe", { value: Prototype.pipe })

const AstNodeBrand = Symbol.for("ts-macros.ast-node")
const TypeNodeBrand = Symbol.for("ts-macros.type-node")

export interface NodeLike extends Pipeable {
  readonly [AstNodeBrand]?: true
  readonly tag: string
}

export interface TypeNodeLike extends Pipeable {
  readonly [TypeNodeBrand]?: true
  readonly tag: string
}

/** a node yields itself, so `yield* node` appends it to the current block */
export interface Yieldable extends NodeLike {
  [Symbol.iterator](): Generator<this, void, unknown>
}

const AstNodePrototype: NodeLike = Object.assign(Object.create(Prototype), { [AstNodeBrand]: true })
const TypeNodePrototype: TypeNodeLike = Object.assign(Object.create(Prototype), { [TypeNodeBrand]: true })
const YieldablePrototype: Yieldable = Object.assign(Object.create(AstNodePrototype), {
  *[Symbol.iterator]() {
    yield this
  },
})

const branded = (value: unknown, brand: symbol): boolean =>
  value !== null && (typeof value === "object" || typeof value === "function") && (value as { readonly [key: symbol]: unknown })[brand] === true

export const isAstNode = (value: unknown): value is NodeLike => branded(value, AstNodeBrand)

export const isTypeNode = (value: unknown): value is TypeNodeLike => branded(value, TypeNodeBrand)

export const makePipeable = <A extends object>(value: A): A & NodeLike => Object.assign(Object.create(AstNodePrototype), value)

export const makeTypeNode = <A extends object>(value: A): A & TypeNodeLike => Object.assign(Object.create(TypeNodePrototype), value)

export const makeYieldable = <A extends object>(value: A): A & Yieldable => Object.assign(Object.create(YieldablePrototype), value)

/** gives a plain function the AST-node brand so a callable can stand in for a node */
export const brandFunction = <F extends object>(fn: F): F & NodeLike => Object.setPrototypeOf(fn, AstNodePrototype) as F & NodeLike
