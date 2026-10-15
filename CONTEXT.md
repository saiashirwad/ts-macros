# ts-macros

Typesafe staged metaprogramming in TypeScript: a TypeScript program builds another TypeScript program, and the type checker follows both.

## Language

**Stage 1**:
The TypeScript program that runs `$.build` and constructs code.
_Avoid_: Host program, generator, macro

**Stage 2**:
The TypeScript program that a target emits from what stage 1 built.
_Avoid_: Output, generated code

**Denotation**:
What an expression means in its language, read at stage 1 as `$.Denotes<E>`. For TypeScript programs built with `$`, it must equal what `tsc` infers for the emitted code under the repo's compiler options; for a binding, its declared type rather than a narrowed use. Narrowing therefore declares a new binding instead of retyping an old one. Another language chooses its own encoding, such as `Int<32>` or `Ptr<T>` for C.
_Avoid_: Phantom type, carried type

**Binding**:
A declared value (a `let`, a `const`, a function, a parameter, a loop variable) that has its own identity, whatever it is named.
_Avoid_: Variable, symbol

**Guard**:
A runtime test on a subject expression together with the type `tsc` gives that subject in each branch. A guarded branch receives the narrowed subject as a fresh annotated `const`.
_Avoid_: Type guard, assertion, cast

**Name hint**:
The name a binding asks for. Emission may always rename it to avoid a clash.
_Avoid_: Name, identifier

**External**:
A host value or type that stage 2 refers to by its exact name and that stage 1 never declares.
_Avoid_: Global, import, FFI value

**Rule**:
A type-level function written as a type lambda: an interface whose `type` reads its arguments from `this["Args"]`, applied with `Kind<Rule, Args>`. Typing rules, conversions and analyses are all rules. Rules compose with combinators such as `AnyOf` and `Under`; only an output of exactly `true` accepts.
_Avoid_: Type function, predicate

**Capability**:
A named rule a language provides, such as `Assign` or `Truthy`.

**Language**:
A name and a record of capabilities. It brands every node, so nodes of different languages never mix. The name is required because TypeScript compares rules structurally and cannot tell two languages' rules apart.
_Avoid_: Dialect

**Construct**:
One node kind: its typed constructor, the runtime structure the kernel walks (children, bindings it declares, bindings it references), and the facts it records. It states the capabilities it needs as a constraint on the language.
_Avoid_: Node type, syntax form

**Kit**:
A bundle of constructs that belong together, such as structured statements.

**Facts**:
What a node records about itself in its type: at least its kind. A body's facts are the union of what it yields, so a program's type lists every node kind it uses, nested ones included.

**Target**:
An open record of handlers keyed by node kind, plus a naming policy. A target may handle more kinds than a program uses, never fewer.
