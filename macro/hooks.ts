// Loader hooks: a `*.macro.ts` module is replaced by the code its program
// emits, so stage 1 runs on the hooks thread and never in the consumer's process.

import type { LoadHook } from "node:module"
import { stripTypeScriptTypes } from "node:module"

export const load: LoadHook = async (url, context, nextLoad) => {
  const parsed = new URL(url)
  // the stage-1 copy imported below comes back through this hook too
  if (!parsed.pathname.endsWith(".macro.ts") || parsed.searchParams.has("stage")) return nextLoad(url, context)
  const captured: string[] = []
  globalThis.__tsMacrosCapture = captured
  try {
    // the query keeps this stage-1 copy apart from any earlier one; a macro
    // module's own dependencies run first, so its emission is the last
    await import(`${url}${url.includes("?") ? "&" : "?"}stage=1&t=${Date.now()}`)
  } finally {
    globalThis.__tsMacrosCapture = undefined
  }
  const source = captured.at(-1)
  if (source === undefined) throw new Error(`${url} never called exports(program)`)
  return { format: "module", source: stripTypeScriptTypes(source), shortCircuit: true }
}
