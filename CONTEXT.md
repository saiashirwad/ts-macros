# ts-macros

Typed staged metaprogramming in TypeScript: a TypeScript program builds a program in another language, and the TypeScript compiler checks it against that language's typing rules.

## Language

**Stage 1**:
The TypeScript program that runs a language's `program` builder and constructs code.
_Avoid_: Host program, generator, macro

**Stage 2**:
The program a target emits from what stage 1 built, written in the target language.
_Avoid_: Output, generated code

**Language**:
A name and a record of capabilities. It brands every node, so nodes of different languages never mix. The name is required because TypeScript compares rules structurally and cannot tell two languages' rules apart.
_Avoid_: Dialect

**Rule**:
A type-level function written as a type lambda: an interface whose `type` reads its arguments from `this["Args"]`, applied with `Kind<Rule, Args>`. Typing rules and conversions are rules. Rules compose with combinators such as `AnyOf`, `Both`, `Under`, and `Not`; only an output of exactly `true` accepts.
_Avoid_: Type function, predicate

**Capability**:
A named rule a language provides: `Assign`, `Truthy`, `Sum`, or `Compare`.

**Denotation**:
What an expression means in its language, read at stage 1 as `Denotes<E>`. Each language chooses its own encoding: TypeScript uses TypeScript types, and C uses `Int<Bits, Signed>`, `Double`, `Ptr<T>`, and `Void`.
_Avoid_: Phantom type, carried type

**Construct**:
One node kind: its typed constructor, the runtime structure the kernel walks (children, bindings it declares, bindings it references), and the facts it records. It states the capabilities it needs as a constraint on the language.
_Avoid_: Node type, syntax form

**Kit**:
A bundle of constructs that belong together: structured statements, functions, or operators.

**Facts**:
What a node records about itself in its type: at least its kind. A body's facts are the union of what it yields, so a program's type lists every node kind it uses, nested ones included.

**Binding**:
A declared value (a `let`, a function, a parameter) that has its own identity, whatever it is named. A reference outside its binding's scope is rejected when the program is built.
_Avoid_: Variable, symbol

**Name hint**:
The name a binding asks for. Emission may rename it to avoid a clash or a reserved word.
_Avoid_: Name, identifier

**Target**:
An open record of handlers keyed by node kind, plus a naming policy. A target may handle more kinds than a program uses, never fewer.

**Naming policy**:
Which identifiers a target accepts and which words it reserves. An invalid name hint is an error, and a reserved or clashing one gets a numeric suffix.
