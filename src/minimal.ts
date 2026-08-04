declare const console: { log: (...args: Array<unknown>) => void }

declare const ExprTypeId: unique symbol

interface Expr<A = unknown> {
  readonly [ExprTypeId]?: A
}

interface Declaration {
  readonly tag: string
}

interface NumberLit extends Expr<number> {
  readonly tag: "number"
  readonly value: number
}

const num = (value: number): NumberLit => ({ tag: "number", value })

interface VarRef<A> extends Expr<A> {
  readonly tag: "var-ref"
  readonly name: string
}

const varRef = <A>(name: string): VarRef<A> => ({ tag: "var-ref", name })

interface LetDecl extends Declaration {
  readonly tag: "let"
  readonly name: string
  readonly init: Expr<unknown>
}

class LetBuilder<A> {
  readonly name: string
  readonly init: Expr<A>

  constructor(name: string, init: Expr<A>) {
    this.name = name
    this.init = init
  }

  *[Symbol.iterator](): Generator<LetDecl, VarRef<A>, unknown> {
    yield { tag: "let", name: this.name, init: this.init }
    return varRef<A>(this.name)
  }
}

const let_ = <A>(name: string, init: Expr<A>): LetBuilder<A> => new LetBuilder(name, init)

interface Program<A> {
  readonly declarations: ReadonlyArray<Declaration>
  readonly result: A
}

function runMacro<A>(factory: () => Generator<Declaration, A, unknown>): Program<A> {
  const iterator = factory()
  const declarations: Array<Declaration> = []

  while (true) {
    const next = iterator.next()
    if (next.done) return { declarations, result: next.value }
    declarations.push(next.value)
  }
}

const program = runMacro(function* () {
  const x = yield* let_("x", num(1))

  const y = yield* let_("y", x)

  return y
})

const expect = <T>(_value: T): void => {}

expect<Program<VarRef<number>>>(program)
expect<ReadonlyArray<Declaration>>(program.declarations)

// @ts-expect-error VarRef<number> is not VarRef<string>
expect<Program<VarRef<string>>>(program)

runMacro(
  // @ts-expect-error yields number, not Declaration
  function* () {
    yield 42
    return num(0)
  },
)

console.log(program)
