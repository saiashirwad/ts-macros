import * as Expr from "./expr.ts"

// Host values: things the program refers to but does not declare. The type
// argument is the only thing the program knows about them.

const rootName = (name: string): string => {
  if (name.includes(".")) throw new Error(`ffi names are root identifiers, got "${name}"`)
  return name
}

const defaultLocal = (source: string): string => source.split("/").pop()!.replace(/^node:/, "").replace(/[^a-zA-Z0-9_$]/g, "")

/** a namespace ref bound to a module; the emitter hoists it into `import * as <local>` */
export const Import = <A>(source: string, local?: string): Expr.ExternalRef<A> => Expr.ExternalRef(local ?? defaultLocal(source), source)

/** a global: `FFI.Value<(path: string) => string>("readFile")` */
export const Value = <A>(name: string): Expr.ExternalRef<A> => Expr.ExternalRef(rootName(name))
