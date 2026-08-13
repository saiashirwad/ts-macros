import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

/**
 * best-effort variable-name inference, so `const answer = yield* $.Const(...)`
 * can name the emitted binding after the authoring variable. the mechanism is
 * stack-trace introspection: capture the callsite's file:line:col, read the
 * source, and parse the `const <name> =` in front of it.
 *
 * deliberately best-effort: it needs the canonical `const x = yield* ...( ... )`
 * shape in real source (no minifier/bundler between you and the file on disk).
 * when it can't see a name it throws, and every sugar entry point still accepts
 * an explicit name.
 */

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

// `const answer = yield* $.Const` — the name in front of the callsite,
// allowing whatever partial callee token the reported column cuts through
const NAME = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*yield\s*\*\s*[\w$.\s]*$/

// `$.forOf(numbers, function*(n) {` — the first generator param after the callsite
const PARAM = /\bfunction\s*\*\s*\(\s*([A-Za-z_$][\w$]*)/

/** the source text surrounding the caller's callsite; `caller`'s frame (and everything above it) is skipped */
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

/** the variable name at the caller's callsite */
export const callsiteName = (caller: (...args: Array<any>) => any): string => {
  const { path, before } = callsite(caller)
  const name = NAME.exec(before)
  if (name !== null) return name[1]!
  throw new Error(
    `could not infer a binding name at ${path} — write it as const x = yield* ...( ... ), or pass the name explicitly`,
  )
}

/** the first generator param name after the caller's callsite — `$.forOf(xs, function*(x) { ... })` */
export const callsiteParamName = (caller: (...args: Array<any>) => any): string => {
  const { path, after } = callsite(caller)
  const param = PARAM.exec(after)
  if (param !== null) return param[1]!
  throw new Error(
    `could not infer a loop variable name at ${path} — write the body as function*(x) { ... }, or pass the name explicitly`,
  )
}
