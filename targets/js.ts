import type { Program } from "../src/program.ts"
import { createTarget, emitTextProgram } from "./ecmascript.ts"

const javascript = createTarget(false)

export const emitProgram = (program: Program<unknown>): string => emitTextProgram(program, javascript)
