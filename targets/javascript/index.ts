import { createTarget, emitTextProgram } from "../../src/emit/ecmascript.ts"
import type { Program } from "../../src/program.ts"

const javascript = createTarget("javascript")

export const emitProgram = (program: Program<unknown>): string => emitTextProgram(program, javascript)
