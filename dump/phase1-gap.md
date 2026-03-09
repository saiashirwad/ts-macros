# Phase 1 gaps (IR/Babel surface)

- `src/ir.ts`: missing planned nodes from complete plan — destructuring (`destructure-array`,
  `destructure-object`), assignment operator details, advanced TS types (conditional, mapped, keyof,
  typeof, indexed-access, template-literal, infer, index-signature, readonly wrappers), richer
  param/typeParam shapes for classes/functions, tagged-template quasi shape, new expressions
  (this/new already present; check computed optional member, etc.).
- `src/babel.ts`: no translation cases for the above advanced types and destructuring; class
  implements/typeParams handling is partial; mapped/conditional/types not supported;
  namespace/export-all-as, etc., present but relies on missing IR shapes.
- `src/dsl.ts`: only minimal builders; lacks helpers for destructuring, advanced types, full
  class/options, import/export variations, namespace details tied to the missing IR.
- Tests: coverage exists for current nodes but none for the missing constructs; snapshot/fixture
  tests needed once IR/Babel parity is added.
