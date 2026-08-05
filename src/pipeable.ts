type Constructor<A = object> = new (...args: Array<any>) => A

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
  switch (args.length) {
    case 0:
      return a
    case 1:
      return args[0]!(a)
    case 2:
      return args[1]!(args[0]!(a))
    case 3:
      return args[2]!(args[1]!(args[0]!(a)))
    case 4:
      return args[3]!(args[2]!(args[1]!(args[0]!(a))))
    case 5:
      return args[4]!(args[3]!(args[2]!(args[1]!(args[0]!(a)))))
    case 6:
      return args[5]!(args[4]!(args[3]!(args[2]!(args[1]!(args[0]!(a))))))
    case 7:
      return args[6]!(args[5]!(args[4]!(args[3]!(args[2]!(args[1]!(args[0]!(a)))))))
    default: {
      let result = a
      for (let index = 0; index < args.length; index++) {
        result = args[index]!(result)
      }
      return result
    }
  }
}

export const pipeArguments = <A>(self: A, args: IArguments): unknown => {
  switch (args.length) {
    case 0:
      return self
    case 1:
      return args[0](self)
    case 2:
      return args[1](args[0](self))
    case 3:
      return args[2](args[1](args[0](self)))
    case 4:
      return args[3](args[2](args[1](args[0](self))))
    case 5:
      return args[4](args[3](args[2](args[1](args[0](self)))))
    case 6:
      return args[5](args[4](args[3](args[2](args[1](args[0](self))))))
    case 7:
      return args[6](args[5](args[4](args[3](args[2](args[1](args[0](self)))))))
    default: {
      let result = self
      for (let index = 0; index < args.length; index++) {
        result = args[index](result)
      }
      return result
    }
  }
}

export interface PipeableConstructor {
  new (...args: Array<any>): Pipeable
}

export const Prototype: Pipeable = {
  pipe() {
    return pipeArguments(this, arguments) as any
  },
}

const Base: PipeableConstructor = (function () {
  function PipeableBase() {}
  PipeableBase.prototype = Prototype
  return PipeableBase as unknown as PipeableConstructor
})()

export const PipeableClass: {
  (): PipeableConstructor
  <TBase extends Constructor>(klass: TBase): TBase & PipeableConstructor
} = (klass?: Constructor) =>
  klass
    ? class extends klass {
        pipe() {
          return pipeArguments(this, arguments) as any
        }
      }
    : Base

export const makePipeable = <A extends object>(value: A): A & Pipeable =>
  Object.assign(Object.create(Prototype), value)
