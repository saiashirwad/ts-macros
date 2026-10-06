import type { Program } from "../src/program.ts"
import { createTarget, emitTextProgram } from "./ecmascript.ts"

const typescript = createTarget(true)

export const emitProgram = (program: Program<unknown>): string => emitTextProgram(program, typescript)
