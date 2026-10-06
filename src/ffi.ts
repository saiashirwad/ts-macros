import { external, type ExternalExpr } from "./expr.ts"
import * as Types from "./types/index.ts"

/** `import * as local from "source"`; the emitter hoists it to the top of the program */
export const hostImport = <A>(source: string, local: string): ExternalExpr<A> => external(local, source)

/** a global: `hostValue<(path: string) => string>("readFile")` */
export const hostValue = <A>(name: string): ExternalExpr<A> => external(name, undefined)

/** a host type: `hostType<Date>("Date")` */
export const hostType = <A>(name: string, ...args: Types.Type<any>[]): Types.External<A> => Types.External<A>(name, ...args)
