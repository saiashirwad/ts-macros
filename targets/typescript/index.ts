import { createTarget, emitTextProgram, type Fragment } from "../../src/emit/ecmascript.ts"
import type { Target } from "../../src/emit/target.ts"
import type { Program } from "../../src/program.ts"

export const typescript: Target<Fragment, string, Fragment> = createTarget("typescript")

export const emitProgram = (program: Program<unknown>): string => emitTextProgram(program, typescript)
