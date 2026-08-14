import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

const sources = new Map<string, string>()
const lineStartsByPath = new Map<string, number[]>()

const sourceOf = (path: string): string => {
  let cached = sources.get(path)
  if (cached === undefined) {
    cached = readFileSync(path, "utf8")
    sources.set(path, cached)
  }
  return cached
}

const offsetAt = (path: string, line: number, col: number): number => {
  const text = sourceOf(path)
  let starts = lineStartsByPath.get(path)
  if (starts === undefined) {
    starts = [0]
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") starts.push(i + 1)
    }
    lineStartsByPath.set(path, starts)
  }
  const start = starts[line - 1]
  return start === undefined ? text.length : Math.min(start + col - 1, text.length)
}

const FRAME = /((?:file:\/\/\/)?[^()\s]+?\.[cm]?[tj]s):(\d+):(\d+)/

// `const x = yield* $.Const` — column may cut through the callee
const NAME = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*yield\s*\*\s*[\w$.\s]*$/

// first generator param after the callsite
const PARAM = /\bfunction\s*\*\s*\(\s*([A-Za-z_$][\w$]*)/

// arrow params after the callsite
const ARROW_PARAMS = /\(\s*((?:[A-Za-z_$][\w$]*\s*(?:,\s*)?)+)\)\s*=>/
const ARROW_SINGLE = /([A-Za-z_$][\w$]*)\s*=>/

const callsite = (caller: (...args: Array<any>) => any): { path: string; before: string; after: string } => {
  const err = {} as { stack?: string }
  Error.captureStackTrace(err, caller)
  for (const frame of (err.stack ?? "").split("\n").slice(1)) {
    const match = FRAME.exec(frame)
    if (!match) continue
    const [, rawPath, rawLine, rawCol] = match
    const path = rawPath!.startsWith("file://") ? fileURLToPath(rawPath!) : rawPath!
    const text = sourceOf(path)
    const offset = offsetAt(path, Number(rawLine), Number(rawCol))
    return { path, before: text.slice(0, offset), after: text.slice(offset, offset + 1000) }
  }
  throw new Error("could not locate the callsite — pass the name explicitly")
}

export const callsiteName = (caller: (...args: Array<any>) => any): string => {
  const { path, before } = callsite(caller)
  const name = NAME.exec(before)
  if (name !== null) return name[1]!
  throw new Error(
    `could not infer a binding name at ${path} — write it as const x = yield* ...( ... ), or pass the name explicitly`,
  )
}

export const callsiteParamName = (caller: (...args: Array<any>) => any): string => {
  const { path, after } = callsite(caller)
  const param = PARAM.exec(after)
  if (param !== null) return param[1]!
  throw new Error(
    `could not infer a loop variable name at ${path} — write the body as function*(x) { ... }, or pass the name explicitly`,
  )
}

export const callsiteParamNames = (caller: (...args: Array<any>) => any): string[] => {
  const { path, after } = callsite(caller)
  const parenthesized = ARROW_PARAMS.exec(after)
  if (parenthesized !== null) return parenthesized[1]!.split(",").map((name) => name.trim())
  const single = ARROW_SINGLE.exec(after)
  if (single !== null) return [single[1]!]
  throw new Error(
    `could not infer type parameter names at ${path} — write the body as (T, E) => ..., or pass the names explicitly`,
  )
}
