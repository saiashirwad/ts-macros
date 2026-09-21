import { type Ref, ref } from "./expr.ts"

// Host values: things the program refers to but does not declare. The type
// argument is the only thing the program knows about them.

/** `import * as local from "source"`; the emitter hoists it to the top of the program */
export const Import = <A>(source: string, local: string): Ref<A> => ref(undefined, local, undefined, false, false, source)

/** a global: `Value<(path: string) => string>("readFile")` */
export const Value = <A>(name: string): Ref<A> => ref(undefined, name, undefined, false, false)
