## design rules

- Preserve symbolic type variables (`Variable<Name>`) and type AST nodes,
  including `Type.Param` and `Type.Apply`. Emitters need these nodes to render
  generic signatures and type applications.
- Attach every type that is known at construction time as a `TypeExpr` on the
  corresponding AST node (`node.type`, `binding.type`, or `fn.returnType`).
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
  (widening, joins, operators, substitution, iteration) is a type and a
  function in `src/types/lattice.ts`. `tests/typing.test.ts` checks that the
  halves agree.
- **Builders.** A builder is an immutable description that extends `Builder`.
  Declaration builders (`Fn.Function`, `Binding.Let`/`Const`, `Type.Type`)
  carry a `declaration` and return a ref when yielded. Control-flow builders
  (`Stmt.If`, `While`, `ForOf`) carry a `spec` and return nothing. A combinator
  returns a new builder. The node is made in `[Symbol.iterator]`, when the
  builder is yielded, and bodies run then, not before. The exceptions are forced:
  a function's `impl` waits until `Program.build` so recursion resolves, and an
  arrow is an expression, so its body runs at construction.
- **Names.** Constructors and builders are Capitalized (`Expr.Binary`,
  `Stmt.If`, `Sugar.Let`, `Sugar.ForOf`); sugar that builds an expression from
  lifted values is lowercase (`Sugar.add`, `Sugar.norm`). A reserved word takes
  a trailing underscore (`else_`, `import_`); a leading underscore means unused
  (`_check`).
- **Targets.** Handlers and their helpers take `(node, emit)`. Anything the
  ECMAScript-syntax targets must agree on (identifiers, template escapes,
  field modifiers) lives in `targets/ecmascript.ts`, and
  `tests/emit.test.ts` runs both targets' output to check that they do. Each
  target module exports its handler table and `emitProgram`.
- **Errors.** Messages start lowercase, quote user-supplied names with `"`,
  and say what was expected.
- **Comments.** `/** */` on exports, saying what the thing means rather than
  how it works; `//` for a note inside a body or a section heading in a file.
