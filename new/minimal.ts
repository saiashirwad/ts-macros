// The whole idea in one file. A toy language with two forms: number
// literals and `let`. Run with `bun new/minimal.ts`.

declare const console: { log: (...args: Array<unknown>) => void };

// ---------------------------------------------------------------------------
// 1. The hack: a phantom type slot
// ---------------------------------------------------------------------------
// `A` never exists at runtime. The symbol is `declare const`, so nothing ever
// writes that key, and the property is optional, so a plain object with the
// right `_tag` structurally satisfies `Expr<number>`. The slot exists only to
// carry a compile-time type on a runtime node.

declare const ExprTypeId: unique symbol;

interface Expr<A = unknown> {
  readonly [ExprTypeId]?: A;
}

interface Declaration {
  readonly _tag: string;
}

// Two runtime nodes. Note neither constructor touches ExprTypeId.

interface NumberLit extends Expr<number> {
  readonly _tag: "number";
  readonly value: number;
}

const num = (value: number): NumberLit => ({ _tag: "number", value });

interface VarRef<A> extends Expr<A> {
  readonly _tag: "var-ref";
  readonly name: string;
}

const varRef = <A>(name: string): VarRef<A> => ({ _tag: "var-ref", name });

// ---------------------------------------------------------------------------
// 2. The builder: an iterable with two separate type channels
// ---------------------------------------------------------------------------
// `Generator<TYield, TReturn, TNext>`:
//   TYield  = LetDecl   -> the node that escapes upward to the collector
//   TReturn = VarRef<A> -> the value `yield*` evaluates to
//   TNext   = unknown   -> unused; nothing is sent back in

interface LetDecl extends Declaration {
  readonly _tag: "let";
  readonly name: string;
  readonly init: Expr<unknown>;
}

class LetBuilder<A> {
  constructor(
    readonly name: string,
    readonly init: Expr<A>,
  ) { }

  *[Symbol.iterator](): Generator<LetDecl, VarRef<A>, unknown> {
    yield { _tag: "let", name: this.name, init: this.init };
    return varRef<A>(this.name);
  }
}

// `A` is captured here from the init expression and parked in the builder.
const let_ = <A>(name: string, init: Expr<A>): LetBuilder<A> =>
  new LetBuilder(name, init);

// ---------------------------------------------------------------------------
// 3. The collector
// ---------------------------------------------------------------------------
// Everything yielded gets pushed; whatever is returned becomes the result.
// The `Declaration` bound on TYield is what makes stray yields a type error.

interface Program<A> {
  readonly declarations: ReadonlyArray<Declaration>;
  readonly result: A;
}

function runMacro<A>(
  factory: () => Generator<Declaration, A, unknown>,
): Program<A> {
  const iterator = factory();
  const declarations: Array<Declaration> = [];

  while (true) {
    const next = iterator.next();
    if (next.done) return { declarations, result: next.value };
    declarations.push(next.value);
  }
}

// ---------------------------------------------------------------------------
// 4. Using it
// ---------------------------------------------------------------------------

const program = runMacro(function*() {
  // One line, two channels:
  //   a LetDecl escapes sideways into `declarations`
  //   `x` binds to the generator's return value, VarRef<number>
  const x = yield* let_("x", num(1));

  // No context type is threaded anywhere. `x` is an ordinary const in an
  // ordinary scope. That is the entire "accumulation" mechanism — the
  // runtime keeps the environment, TypeScript types each binding locally.
  const y = yield* let_("y", x);

  return y;
});

// ---------------------------------------------------------------------------
// 5. Proof
// ---------------------------------------------------------------------------

const expect = <T>(_value: T): void => { };

expect<Program<VarRef<number>>>(program);
expect<ReadonlyArray<Declaration>>(program.declarations);

// The value channel keeps full precision...
// @ts-expect-error VarRef<number> is not VarRef<string>
expect<Program<VarRef<string>>>(program);

// ...but the yield channel is checked, then discarded. TypeScript infers the
// factory's TYield as the union of every yield (here just `LetDecl`) and
// checks it against `Declaration`. Program.declarations is widened, so
// declarations[0] is only ever `Declaration`.
//
// Note where the error lands: on the argument, not on the `yield`. The
// generator itself is happy to infer `Generator<number, ...>`; it is the
// `Declaration` bound on runMacro's parameter that rejects it.
runMacro(
  // @ts-expect-error yields number, not Declaration
  function*() {
    yield 42;
    return num(0);
  },
);

console.log(program);
