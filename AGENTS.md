## design rules

- Preserve symbolic type variables (`Variable<Name>`) and type AST nodes,
  including `Type.Param` and `Type.Apply`. Emitters need these nodes to render
  generic signatures and type applications.
- Attach every type that is known at construction time as a `TypeExpr` on the
  corresponding AST node (`node.type`, `binding.type`, or `fn.returnType`).
- Keep ASTs pure and immutable. Materialization must return rebuilt nodes
  instead of mutating declarations or expression trees in place.
