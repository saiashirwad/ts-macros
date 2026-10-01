# ts-macros

Typesafe staged metaprogramming in TypeScript: a TypeScript program builds another TypeScript program, and the type checker follows both.

## Language

**Stage 1**:
The TypeScript program that runs `Program.build` and constructs code.
_Avoid_: Host program, generator, macro

**Stage 2**:
The TypeScript program that a target emits from what stage 1 built.
_Avoid_: Output, generated code

**Denotation**:
The stage-2 type an expression will have, read at stage 1 as `Expr.Denotes<E>`. It must equal what `tsc` infers for the emitted code under the repo's compiler options; for a binding, its declared type rather than a narrowed use.
_Avoid_: Phantom type, carried type

**Binding**:
A declared value (a `let`, a `const`, a function, a parameter, a loop variable) that has its own identity, whatever it is named.
_Avoid_: Variable, symbol

**Name hint**:
The name a binding asks for. Emission may always rename it to avoid a clash.
_Avoid_: Name, identifier

**External**:
A host value or type that stage 2 refers to by its exact name and that stage 1 never declares.
_Avoid_: Global, import, FFI value

**Splice**:
A stage-1 computation run with `yield*`: the statements it yields land at that point in stage 2, and it returns a value to stage 1, usually an expression. A body is a function returning one.
_Avoid_: Macro, generator, builder
