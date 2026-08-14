export const NodeBrand: unique symbol = Symbol("ts-macros/node")

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

const pipeArguments = (self: unknown, args: ArrayLike<(_: unknown) => unknown>): unknown => {
  let result = self
  for (let index = 0; index < args.length; index++) {
    result = args[index]!(result)
  }
  return result
}

export interface PipeableConstructor {
  new(...args: Array<any>): Pipeable
}

export const stagingError = (node: unknown): never => {
  const tag = (node as { tag?: string } | null)?.tag ?? "node"
  throw new Error(
    `staging error: a ${tag} node escaped into a JavaScript operator (>, +, *, string interpolation, ...). `
      + "JS operators run at metaprogram time and cannot build nodes — use the sugar functions (add, sub, gt, ...) or $.expr for props/calls",
  )
}

export const Prototype: Pipeable = Object.assign({}, {
  [Symbol.toPrimitive](): never {
    return stagingError(this)
  },
  pipe() {
    return pipeArguments(this, arguments as ArrayLike<(_: unknown) => unknown>) as any
  },
})

const Base: PipeableConstructor = (function() {
  function PipeableBase() {}
  PipeableBase.prototype = Prototype
  return PipeableBase as unknown as PipeableConstructor
})()

export const PipeableClass = (): PipeableConstructor => Base

export const makePipeable = <A extends object>(value: A): A & Pipeable => Object.assign(Object.create(Prototype), { [NodeBrand]: true }, value)

export interface Yieldable extends Pipeable {
  [Symbol.iterator](): Generator<this, void, unknown>
}

const YieldablePrototype: Yieldable = Object.assign(Object.create(Prototype), {
  *[Symbol.iterator]() {
    yield this
  },
})

export const makeYieldable = <A extends object>(value: A): A & Yieldable =>
  Object.assign(Object.create(YieldablePrototype), { [NodeBrand]: true }, value)
