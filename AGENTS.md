## design invariant

when type information can be expressed and computed by TypeScript's own type
system, let TypeScript do it.

preserve unresolved type information symbolically until enough generic
variables are known, then reduce it using TypeScript's type system. do not
recreate the TypeScript checker through runtime descriptors, registries, or
custom inference machinery unless there is genuinely no simpler way.

prefer preserving knowledge over collapsing something unresolved to
`unknown`.

before endorsing any runtime machinery, ask: could a conditional or mapped
type compute this instead?
