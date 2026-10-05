import type { Target } from "../src/emit/target.ts"
import type { Program } from "../src/program.ts"
import { createTarget, emitTextProgram, type Fragment } from "./ecmascript.ts"

export const typescript: Target<Fragment, string, Fragment> = createTarget(true)

export const emitProgram = (program: Program<unknown>): string => emitTextProgram(program, typescript)
