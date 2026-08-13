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

export function pipe<A>(a: A): A
export function pipe<A, B = never>(a: A, ab: (a: A) => B): B
export function pipe<A, B = never, C = never>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
export function pipe<A, B = never, C = never, D = never>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
): D
export function pipe<A, B = never, C = never, D = never, E = never>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
): E
export function pipe<A, B = never, C = never, D = never, E = never, F = never>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
): F
export function pipe<A, B = never, C = never, D = never, E = never, F = never, G = never>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
): G
export function pipe<
  A,
  B = never,
  C = never,
  D = never,
  E = never,
  F = never,
  G = never,
  H = never,
>(
  a: A,
  ab: (a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D,
  de: (d: D) => E,
  ef: (e: E) => F,
  fg: (f: F) => G,
  gh: (g: G) => H,
): H
export function pipe(a: unknown, ...args: ReadonlyArray<(a: any) => any>): unknown {
  return pipeArguments(a, args)
}

export interface PipeableConstructor {
  new(...args: Array<any>): Pipeable
}

export const Prototype: Pipeable = {
  pipe() {
    return pipeArguments(this, arguments as ArrayLike<(_: unknown) => unknown>) as any
  },
}

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

export const YieldablePrototype: Yieldable = {
  pipe() {
    return pipeArguments(this, arguments as ArrayLike<(_: unknown) => unknown>) as any
  },
  *[Symbol.iterator]() {
    yield this
  },
}

export const makeYieldable = <A extends object>(value: A): A & Yieldable =>
  Object.assign(Object.create(YieldablePrototype), { [NodeBrand]: true }, value)
