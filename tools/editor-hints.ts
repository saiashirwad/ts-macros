import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { version } from "typescript"
import { editorFile, type HoverProbe, type Probe, probes } from "./editor-contracts.ts"

type Position = { line: number; character: number }
type HoverObservation = { kind: string; text: string }
type ParameterLabel = string | [number, number]
type SignatureObservation = {
  signatures: { label: string; parameters: ParameterLabel[] }[]
  activeSignature: number
  activeParameter: number
}
type CompletionObservation = { labels: string[] }
type CleanDiagnosticReport = { kind: "full"; items: [] }
type Observation = HoverObservation | SignatureObservation | CompletionObservation
type RequestId = string | number
type LspMessage =
  | { id: RequestId; method: string; params?: unknown }
  | { method: string; params?: unknown }
  | { id: RequestId; result: unknown }
  | { id: RequestId; error: { code: number; message: string } }
type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

function assertRecord(value: unknown, message: string): asserts value is Record<string, unknown> {
  assert.ok(typeof value === "object" && value !== null && !Array.isArray(value), message)
}

function assertCleanDiagnosticReport(result: unknown): asserts result is CleanDiagnosticReport {
  assertRecord(result, "invalid diagnostic report")
  assert.equal(result.kind, "full")
  assert.deepEqual(result.items, [], "editor corpus must have zero diagnostics")
}

const args = process.argv.slice(2)
assert.ok(args.every((arg) => ["--update", "--inspect"].includes(arg)), "expected --update or --inspect")
const update = args.includes("--update")
const file = resolve(editorFile)
const uri = pathToFileURL(file).href
const source = readFileSync(file, "utf8")
const snapshotFile = "tests/editor-contract.snapshot.json"
const position = (text: string, probe: Probe): Position => {
  const index = text.indexOf(probe.anchor)
  assert.notEqual(index, -1, `${probe.id} anchor missing`)
  assert.equal(text.indexOf(probe.anchor, index + 1), -1, `${probe.id} anchor ambiguous`)
  const lines = text.slice(0, index + probe.offset).split("\n")
  return { line: lines.length - 1, character: (lines.at(-1) ?? "").length }
}
for (const probe of probes) position(source, probe)

const child = spawn(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "--lsp", "--stdio"], { stdio: ["pipe", "pipe", "pipe"] })
const pending = new Map<RequestId, PendingRequest>()
let sequence = 0
let bytes = Buffer.alloc(0)
let logs = ""
const send = (message: LspMessage) => {
  const body = JSON.stringify({ jsonrpc: "2.0", ...message })
  child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`)
}
const failPending = (error: unknown) => {
  for (const { reject, timer } of pending.values()) {
    clearTimeout(timer)
    reject(error)
  }
  pending.clear()
}
const receive = (message: unknown) => {
  assertRecord(message, "invalid LSP message")
  assert.equal(message.jsonrpc, "2.0", "invalid JSON-RPC version")
  const { id, method } = message
  assert.ok(id === undefined || typeof id === "number" || typeof id === "string", "invalid LSP message id")
  assert.ok(method === undefined || typeof method === "string", "invalid LSP message method")
  if (method && id !== undefined) {
    switch (method) {
      case "client/registerCapability":
      case "window/workDoneProgress/create":
        send({ id, result: null })
        break
      case "workspace/configuration":
        assertRecord(message.params, "invalid configuration request params")
        assert.ok(Array.isArray(message.params.items), "invalid configuration request items")
        send({ id, result: message.params.items.map(() => ({})) })
        break
      case "workspace/workspaceFolders":
        send({ id, result: [{ uri: pathToFileURL(`${process.cwd()}/`).href, name: "ts-macros" }] })
        break
      default:
        send({ id, error: { code: -32601, message: `Unsupported client request ${method}` } })
    }
    return
  }
  if (id !== undefined) {
    const entry = pending.get(id)
    assert.ok(entry, `unexpected response id ${id}`)
    pending.delete(id)
    clearTimeout(entry.timer)
    if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  } else if (message.method === "window/logMessage") {
    assertRecord(message.params, "invalid log message params")
    assert.equal(typeof message.params.message, "string", "invalid log message text")
    logs = `${logs}\n${message.params.message}`.slice(-8000)
  }
}
child.stdout.on("data", (chunk: Buffer) => {
  try {
    bytes = Buffer.concat([bytes, chunk])
    while (true) {
      const end = bytes.indexOf("\r\n\r\n")
      if (end === -1) break
      const match = bytes.subarray(0, end).toString().match(/^Content-Length: (\d+)$/im)
      assert.ok(match, "missing LSP Content-Length")
      const length = Number(match[1])
      assert.ok(length > 0 && length < 16_000_000, "invalid LSP payload length")
      if (bytes.length < end + 4 + length) break
      const message: unknown = JSON.parse(bytes.subarray(end + 4, end + 4 + length).toString())
      bytes = bytes.subarray(end + 4 + length)
      receive(message)
    }
  } catch (error) {
    failPending(error)
    child.kill()
  }
})
child.stderr.on("data", (chunk: Buffer) => {
  logs = `${logs}${chunk}`.slice(-8000)
})
child.on("error", failPending)
child.stdin.on("error", failPending)
child.on("exit", (code, signal) => {
  failPending(new Error(`LSP exited ${code ?? signal}\n${logs}`))
})
const request = (method: string, params?: unknown): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const id = ++sequence
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`LSP timeout for ${method}\n${logs}`))
    }, 30_000)
    pending.set(id, { resolve, reject, timer })
    send({ id, method, params })
  })
function normalize(probe: HoverProbe, result: unknown): HoverObservation
function normalize(probe: Probe, result: unknown): Observation
function normalize(probe: Probe, result: unknown): Observation {
  assert.ok(result, `${probe.id} returned no ${probe.method}`)
  if (probe.method === "hover") {
    assertRecord(result, `${probe.id} requires hover result`)
    assertRecord(result.contents, `${probe.id} requires MarkupContent`)
    const { kind, value } = result.contents
    assert.ok(typeof value === "string", `${probe.id} requires nonempty MarkupContent`)
    assert.match(value, /[\s\S]+/, `${probe.id} requires nonempty MarkupContent`)
    assert.ok(typeof kind === "string", `${probe.id} requires MarkupContent kind`)
    return { kind, text: value.replaceAll("\r\n", "\n").trim() }
  }
  if (probe.method === "signatureHelp") {
    assertRecord(result, `${probe.id} requires signature result`)
    assert.ok(Array.isArray(result.signatures) && result.signatures.length > 0, `${probe.id} requires signatures`)
    const signatures = result.signatures.map((signature: unknown) => {
      assertRecord(signature, `${probe.id} requires signature information`)
      const { label, parameters } = signature
      assert.ok(typeof label === "string", `${probe.id} requires signature label`)
      assert.ok(parameters === undefined || Array.isArray(parameters), `${probe.id} requires parameters`)
      return {
        label,
        parameters: (parameters ?? []).map((parameter: unknown): ParameterLabel => {
          assertRecord(parameter, `${probe.id} requires parameter information`)
          const { label } = parameter
          if (typeof label === "string") return label
          assert.ok(Array.isArray(label) && label.length === 2, `${probe.id} requires parameter label`)
          const [start, end] = label
          assert.ok(typeof start === "number" && typeof end === "number", `${probe.id} requires parameter label offsets`)
          return [start, end]
        }),
      }
    })
    const activeSignature = result.activeSignature ?? 0
    const activeParameter = result.activeParameter ?? 0
    assert.ok(typeof activeSignature === "number" && typeof activeParameter === "number", `${probe.id} requires active signature indices`)
    return { signatures, activeSignature, activeParameter }
  }
  let items: unknown
  if (Array.isArray(result)) items = result
  else {
    assertRecord(result, `${probe.id} requires completion result`)
    items = result.items
  }
  assert.ok(Array.isArray(items) && items.length > 0, `${probe.id} requires completion entries`)
  const labels = [
    ...new Set(items.map((item: unknown) => {
      assertRecord(item, `${probe.id} requires completion item`)
      assert.ok(typeof item.label === "string", `${probe.id} requires completion label`)
      return item.label
    })),
  ].sort()
  return { labels }
}
const validate = (probe: Probe, observation: Observation) => {
  assert.ok(observation, `${probe.id} observation missing`)
  assert.ok(
    (probe.method === "hover" && "text" in observation)
      || (probe.method === "signatureHelp" && "signatures" in observation)
      || (probe.method === "completion" && "labels" in observation),
    `${probe.id} observation kind does not match ${probe.method}`,
  )
  const text = "text" in observation
    ? observation.text
    : "signatures" in observation
    ? observation.signatures.map(({ label }) => label).join("\n")
    : observation.labels.join("\n")
  assert.match(text, /[\s\S]+/, `${probe.id} requires nonempty text`)
  for (const expected of probe.require) {
    if ("labels" in observation) assert.ok(observation.labels.includes(expected), `${probe.id} missing entry ${expected}`)
    else assert.ok(text.includes(expected), `${probe.id} missing ${expected}\n${text}`)
  }
  if (probe.method === "hover") {
    assert.ok(text.length <= probe.maxLength, `${probe.id} hover exceeds ${probe.maxLength} characters`)
    assert.doesNotMatch(
      text,
      /(?:\.\.\.\s*\d+\s*more|…|Ref<(?:any|never|unknown)\b|:\s*(?:any|never|unknown)\s*(?:\n|$))/,
      `${probe.id} has a degraded or truncated consumer type`,
    )
  }
  if (probe.method === "signatureHelp") {
    assert.ok("activeParameter" in observation, `${probe.id} requires signature observation`)
    assert.equal(observation.activeParameter, probe.activeParameter, `${probe.id} active argument`)
  }
}

const observations: Record<string, Observation> = {}
try {
  const initialized = await request("initialize", {
    processId: process.pid,
    rootUri: pathToFileURL(`${process.cwd()}/`).href,
    workspaceFolders: [{ uri: pathToFileURL(`${process.cwd()}/`).href, name: "ts-macros" }],
    capabilities: {
      general: { positionEncodings: ["utf-16"] },
      textDocument: {
        hover: { contentFormat: ["markdown", "plaintext"] },
        completion: { completionItem: { snippetSupport: true } },
        signatureHelp: { signatureInformation: { parameterInformation: { labelOffsetSupport: true } } },
      },
    },
  })
  assertRecord(initialized, "invalid initialize result")
  assertRecord(initialized.serverInfo, "invalid server info")
  assertRecord(initialized.capabilities, "invalid server capabilities")
  assert.equal(initialized.serverInfo.version, version, "LSP must use locked compiler")
  assert.equal(initialized.capabilities.positionEncoding, "utf-16")
  for (const key of ["hoverProvider", "signatureHelpProvider", "completionProvider", "diagnosticProvider"]) {
    assert.ok(initialized.capabilities[key], `LSP lacks ${key}`)
  }
  send({ method: "initialized", params: {} })
  send({ method: "textDocument/didOpen", params: { textDocument: { uri, languageId: "typescript", version: 1, text: source } } })
  const diagnostics = await request("textDocument/diagnostic", { textDocument: { uri } })
  assertCleanDiagnosticReport(diagnostics)
  for (const probe of probes) {
    const result = await request(`textDocument/${probe.method}`, { textDocument: { uri }, position: position(source, probe) })
    const observation = normalize(probe, result)
    if (args.includes("--inspect")) console.log(probe.id, JSON.stringify(observation))
    observations[probe.id] = observation
    validate(probe, observation)
  }
  const treeProbe = probes.find(({ id }) => id === "saved-tree")
  assert.ok(treeProbe?.method === "hover", "saved-tree hover probe missing")
  const treeObservation = observations[treeProbe.id]
  assert.ok(treeObservation && "text" in treeObservation, "saved-tree hover observation missing")
  for (
    const text of [
      "const savedTree: Ref<any, false, false, []>",
      "const savedTree: Ref<never, false, false, []>",
      `${treeObservation.text}\n... 3 more`,
      `${treeObservation.text}${" ".repeat(1201)}`,
    ]
  ) {
    assert.throws(() => validate(treeProbe, { kind: treeObservation.kind, text }), /missing|degraded|truncated|exceeds/, "toxic hover must fail")
  }
  const original = "T.hostValue<Tree>(\"tree\")"
  assert.equal(source.split(original).length, 2)
  const mutated = source.replace(original, "T.hostValue<any>(\"tree\")")
  send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 2 }, contentChanges: [{ text: mutated }] } })
  const degraded = normalize(treeProbe, await request("textDocument/hover", { textDocument: { uri }, position: position(mutated, treeProbe) }))
  assert.match(degraded.text, /Ref<any\b/, "LSP degradation control must capture changed savedTree")
  assert.throws(() => validate(treeProbe, degraded), /missing|degraded/, "real degraded hover must fail normal validator")
  send({ method: "textDocument/didChange", params: { textDocument: { uri, version: 3 }, contentChanges: [{ text: source }] } })
  const restored = normalize(treeProbe, await request("textDocument/hover", { textDocument: { uri }, position: position(source, treeProbe) }))
  assert.deepEqual(restored, observations[treeProbe.id], "restored hover must recover")
  const snapshot = { compilerVersion: version, observations }
  mkdirSync(".cache", { recursive: true })
  writeFileSync(".cache/editor-actual.json", `${JSON.stringify(snapshot, null, 2)}\n`)
  if (update) writeFileSync(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`)
  else assert.deepEqual(snapshot, JSON.parse(readFileSync(snapshotFile, "utf8")), "editor output changed; review before editor:update")
  console.log(`TS ${version} LSP passed ${probes.length} probes and degraded-hover controls`)
  await request("shutdown")
  send({ method: "exit" })
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, 1000)
    child.once("exit", () => {
      clearTimeout(timer)
      resolve()
    })
  })
} catch (error) {
  mkdirSync(".cache", { recursive: true })
  writeFileSync(
    ".cache/editor-actual.json",
    `${JSON.stringify({ compilerVersion: version, observations, failure: error instanceof Error ? error.message : String(error), logs }, null, 2)}\n`,
  )
  throw error
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill()
  failPending(new Error("LSP check finished"))
}
