import { type External, external } from "./expr.ts"
import * as Types from "./types/index.ts"

// Host values: things the program refers to but does not declare. The type
// argument is the only thing the program knows about them.

/** `import * as local from "source"`; the emitter hoists it to the top of the program */
export const Import = <A>(source: string, local: string): External<A> => external(local, source)

/** a global: `Value<(path: string) => string>("readFile")` */
export const Value = <A>(name: string): External<A> => external(name, undefined)

/** a host type: `FFI.Type<Date>("Date")` */
export const Type = <A>(name: string, ...args: Types.Type<any>[]): Types.External<A> => Types.external<A>(name, ...args)
