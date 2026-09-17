## design rules

- Preserve symbolic type variables (`Variable<Name>`) and type AST nodes,
  including `Type.Param` and `Type.Apply`. Emitters need these nodes to render
  generic signatures and type applications.
- Attach every type that is known at construction time as a `TypeExpr` on the
  corresponding AST node, in its `type` field. What the user declared is kept
  apart from what was inferred (`binding.annotation`, `fn.returnType`), and an
  emitter prints only what was declared.
- Keep ASTs pure and immutable. Materialization must return rebuilt nodes
  instead of mutating declarations or expression trees in place.

## conventions

There is one way to do each of these. Follow it; if it is wrong, change it
everywhere.

- **Nodes.** Every node is made by `makeNode`, `makeStatement`, or
  `makeTypeNode` (`src/node.ts`): statements with `makeStatement`, type nodes
  with `makeTypeNode`, everything else with `makeNode`. A node kind has one
  constructor, and that is the only place its record is written. A pass that
  changes a node rebuilds it through the constructor, or spreads it into a
  `make*` call when only a field changes.
- **Node kinds.** A kind is an interface with a literal `tag` plus a
  constructor, defined together. Each domain closes with an `Any` union
  (`Expr.Any`, `Fn.Any`, `Type.Any`, and `Stmt.Statement`) so passes and
  emitters can switch exhaustively. Adding a kind means adding it to the union
  and fixing every switch the compiler then points at.
- **Absence.** A value that may be missing is `undefined`, typed
  `field?: T | undefined`; the IR holds no `null`. A list is never missing,
  only empty (`params: []`, `args: []`).
- **Typing rules.** A rule is written twice: over type nodes (what `node.type`
  gets) and over denotations (what the phantom says), and the two halves sit
  next to each other. A rule that belongs to one node is that node's interface
  (the phantom) and its constructor (the data). A rule several nodes share
  (widening, freshness, joins, operators, substitution, iteration) is a type
  and a function in `src/types/lattice.ts`. A rule that depends on the
  expression and not just its type (freshness) is written over expression
  nodes on both halves, which is why `Init`, `Return` and `norm` keep node
  types rather than only what they denote. `tests/typing.test.ts` checks that the
  halves agree.
- **Builders.** A builder is an immutable description that extends `Builder`;
  a combinator returns a new one. A declaration is built in two stages.
  `Fn.Function(name)`, `Binding.Let(name)` and `Binding.Const(name)` are
  drafts: they carry a `declaration`, take the optional steps (`TypeParams`,
  `Params`, `Returns`; `Annotate`), and cannot be yielded. One terminal step
  (`Impl`; `Init` or `Declare`) checks its argument against everything the
  draft declared and returns the builder, which can be yielded, returns a ref,
  and takes no more steps. `Type.Type(name, body)` has nothing to wait for and
  is a builder at once. Control-flow builders (`Stmt.If`, `While`, `ForOf`)
  carry a `spec` and return nothing. The node is made in `[Symbol.iterator]`,
  when the builder is yielded, and bodies run then, not before. The exceptions
  are forced: a function's `impl` waits until `Program.build` so recursion
  resolves, and an arrow is an expression, so its body runs at construction.
- **Type-level checks.** A constructor rejects a bad argument with a
  `..._check` rest parameter whose type is `[]` or an error tuple. A pipe step
  cannot: held in a variable it is a generic function, and TypeScript unifies
  it with `pipe`'s callback without counting parameters. A pipe step
  intersects the check onto the draft it takes (`draft: Draft & Check`, where
  `Check` is `unknown` or an error tuple), and a draft whose type arguments
  matter is invariant in them.
- **Names.** Constructors and builders are Capitalized (`Expr.Binary`,
  `Stmt.If`, `Sugar.Let`, `Sugar.ForOf`); sugar that builds an expression from
  lifted values is lowercase (`Sugar.add`, `Sugar.norm`). A reserved word takes
  a trailing underscore (`else_`, `import_`); a leading underscore means unused
  (`_check`).
- **Targets.** A target is a table of handlers, one per node tag, and exports
  that table and `emitProgram`. Handlers and their helpers take
  `(node, emit)`. A target that writes text by hand owns its precedence and
  escaping rules; `tests/emit.test.ts` runs the emitted code to check them.
- **Errors.** Messages start lowercase, quote user-supplied names with `"`,
  and say what was expected.
- **Comments.** `/** */` on exports, saying what the thing means rather than
  how it works; `//` for a note inside a body or a section heading in a file.
