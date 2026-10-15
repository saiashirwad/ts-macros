import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const replaceOne = (source: string, original: string, replacement: string): string => {
  assert.equal(source.split(original).length, 2, `seed must match once: ${original}`)
  return source.replace(original, replacement)
}
type ExpectedDiagnostic = { location: string; code: number }
type MutationSeed = { id: string; original: string; replacement: string; diagnostics: ExpectedDiagnostic[] }
type CompilerDiagnostic = { file: string | undefined; line: string | undefined; code: string }

type Fixture = { file: string; seeds: MutationSeed[] }
const unusedDirective = (id: string, original: string, replacement: string, directive: string): MutationSeed => ({
  id,
  original,
  replacement,
  diagnostics: [{ location: `// @ts-expect-error ${directive}`, code: 2578 }],
})

const languageSeeds: MutationSeed[] = [
  unusedDirective(
    "c-pointee",
    "yield* c.let(\"r\", p, c.ptr(c.double))",
    "yield* c.let(\"r\", p, c.ptr(c.int(32)))",
    "int* to double* needs a cast in C",
  ),
  unusedDirective(
    "c-untyped",
    "yield* c.let(\"untyped\", n)",
    "yield* c.let(\"untyped\", n, c.int(32))",
    "a C binding needs a declared type",
  ),
  unusedDirective(
    "c-argument",
    "c.call(square, c.address(c.call(square, i32(1))))",
    "c.call(square, i32(1))",
    "a pointer argument does not convert to an int parameter",
  ),
  unusedDirective(
    "c-nested-return",
    "yield* c.return(p)",
    "yield* c.return(i32(1))",
    "a pointer is returned from a function declared to return an int, even from a nested branch",
  ),
  unusedDirective(
    "language-brand",
    "yield* c.let(\"y\", tsInt, c.int(32))",
    "yield* c.let(\"y\", lang.ref<C, Int<32, true>>(lang.binding(\"cInt\"), c.int(32)), c.int(32))",
    "a TypeScript expression cannot initialize a C binding",
  ),
  unusedDirective(
    "capability",
    "lang.ifConstruct<Logic>()",
    "lang.ifConstruct<Logic & { readonly Truthy: lang.Assignable }>()",
    "Logic has no Truthy rule, which `if` needs",
  ),
  unusedDirective(
    "nested-handler",
    "lang.defineTarget(cTarget.naming, withoutLess)), /target",
    "lang.defineTarget(cTarget.naming, cTarget.handlers)), /target",
    "target has no handler for \"less\", which is only used in a nested while condition",
  ),
]

const typescriptSeeds: MutationSeed[] = [
  unusedDirective(
    "ts-host-erased-generic",
    "ts.hostValue<string>(\"erased\", ts.string)",
    "ts.hostValue(\"erased\", ts.string)",
    "an erased host generic is not a runtime type witness",
  ),
  unusedDirective(
    "ts-host-witness-type",
    "yield* ts.let(\"text\", number, ts.string)",
    "yield* ts.let(\"text\", number, ts.number)",
    "a host witness determines the value's type",
  ),
  unusedDirective(
    "ts-union-member",
    "yield* ts.let(\"v\", ts.literal(true), ts.union(ts.string, ts.number))",
    "yield* ts.let(\"v\", ts.literal(\"v\"), ts.union(ts.string, ts.number))",
    "a boolean is not a string or a number",
  ),
  unusedDirective(
    "ts-literal-type",
    "yield* ts.let(\"off\", ts.literal(\"off\"), ts.literalType(\"on\"))",
    "yield* ts.let(\"off\", ts.literal(\"on\"), ts.literalType(\"on\"))",
    "\"off\" is not the literal type \"on\"",
  ),
  unusedDirective(
    "ts-template-pattern",
    "yield* ts.let(\"bad\", ts.literal(\"user-x-a\"), id)",
    "yield* ts.let(\"bad\", ts.literal(\"user-2-b\"), id)",
    "\"user-x-a\" does not match `user-${number}-a`",
  ),
  unusedDirective(
    "ts-template-interpolation",
    "ts.template(\"a\", ts.object({}))",
    "ts.template(\"a\", ts.literalType(1))",
    "an object type cannot be interpolated into a template literal type",
  ),
  unusedDirective(
    "ts-index-key",
    "ts.index(user, ts.literalType(\"email\"))",
    "ts.index(user, ts.literalType(\"name\"))",
    "\"email\" is not a key of the object type",
  ),
  unusedDirective(
    "ts-alias-constraint",
    "Keyed(ts.number, ts.string)",
    "Keyed(ts.literalType(\"k\"), ts.string)",
    "a number does not satisfy the constraint string",
  ),
  unusedDirective(
    "ts-generic-index",
    "(T, K) => ts.index(T, K))",
    "(T, K) => ts.index(T, ts.keyof(T)))",
    "K is not known to be a key of T",
  ),
  unusedDirective(
    "ts-generic-template",
    "[ts.typeParam(\"P\")], (P) => ts.template(P))",
    "[ts.typeParam(\"P\", ts.number)], (P) => ts.template(P))",
    "an unconstrained parameter cannot be interpolated into a template literal type",
  ),
  unusedDirective(
    "ts-infer-result",
    "\"y\", ts.literal(\"y\"),",
    "\"y\", ts.literal(\"x\"),",
    "\"y\" is not the element type \"x\"",
  ),
  unusedDirective(
    "ts-infer-unconstrained",
    "(E) => ts.template(E)",
    "(E) => ts.template(\"e\")",
    "E is not known to be a string, so it cannot be interpolated",
  ),
  unusedDirective(
    "ts-mapped-key",
    "ts.mapped(\"K\", ts.union(ts.literalType(\"a\"), ts.literalType(\"b\")), (K) => ts.index(ts.object({ a: ts.number }), K))",
    "ts.mapped(\"K\", ts.literalType(\"a\"), (K) => ts.index(ts.object({ a: ts.number }), K))",
    "the key \"b\" is not a key of { a: number }",
  ),
  unusedDirective(
    "ts-narrowed-branch",
    "yield* ts.let(\"wide\", x, ts.string)",
    "yield* ts.let(\"wide\", text, ts.string)",
    "outside the branch, x is a string or a number",
  ),
  unusedDirective(
    "ts-narrowed-assign",
    "ts.assign(text, ts.literal(true))",
    "ts.assign(text, ts.literal(2))",
    "a boolean is not assignable to the declared string | number",
  ),
  unusedDirective(
    "ts-predicate-parameter",
    "ts.fn(\"isText\", [ts.param(\"value\", ts.number)], ts.predicate(0, ts.string)",
    "ts.fn(\"isText\", [ts.param(\"value\", ts.number)], ts.predicate(0, ts.literalType(1))",
    "a type predicate's type must be assignable to the parameter's type",
  ),
  unusedDirective(
    "ts-predicate-result",
    "yield* ts.return(ts.literal(1))",
    "yield* ts.return(ts.literal(true))",
    "a type predicate function returns a boolean",
  ),
  unusedDirective(
    "ts-rest-parameter",
    "ts.functionType([], ts.void, ts.string)",
    "ts.functionType([], ts.void, ts.array(ts.string))",
    "a rest parameter must be an array type",
  ),
  unusedDirective(
    "ts-function-value",
    "yield* ts.let(\"g\", double, ts.functionType([ts.string], ts.number))",
    "yield* ts.let(\"g\", double, ts.functionType([ts.number], ts.number))",
    "double takes a number, not a string",
  ),
  unusedDirective(
    "ts-function-call",
    "ts.call(f, ts.literal(\"1\"))",
    "ts.call(f, ts.literal(1))",
    "f takes a number",
  ),
  unusedDirective(
    "ts-tuple-optional",
    "ts.tuple(ts.optional(ts.string), ts.number)",
    "ts.tuple(ts.optional(ts.string), ts.optional(ts.number))",
    "a required element cannot follow an optional element",
  ),
  unusedDirective(
    "ts-tuple-rest-optional",
    "ts.tuple(ts.spread(ts.array(ts.string)), ts.optional(ts.number))",
    "ts.tuple(ts.spread(ts.array(ts.string)), ts.number)",
    "an optional element cannot follow a rest element",
  ),
  unusedDirective(
    "ts-tuple-rest-rest",
    "ts.tuple(ts.spread(ts.array(ts.string)), ts.spread(ts.array(ts.number)))",
    "ts.tuple(ts.spread(ts.tuple(ts.string)), ts.spread(ts.array(ts.number)))",
    "a rest element cannot follow another rest element",
  ),
  unusedDirective(
    "ts-tuple-spread",
    "ts.spread(ts.string)",
    "ts.spread(ts.array(ts.string))",
    "only an array or tuple type can be spread",
  ),
  unusedDirective(
    "ts-get-common",
    "ts.get(s, \"r\")",
    "ts.get(s, \"kind\")",
    "r is not a property of every figure",
  ),
  unusedDirective(
    "ts-equality-overlap",
    "ts.equals(ts.get(s, \"kind\"), ts.literal(1))",
    "ts.equals(ts.get(s, \"kind\"), ts.literal(\"x\"))",
    "a string is never equal to a number",
  ),
  unusedDirective(
    "ts-equality-objects",
    "ts.equals(o, q)",
    "ts.equals(o, o)",
    "object types with incompatible properties have no overlap",
  ),
  unusedDirective(
    "ts-function-property",
    "ts.get(g, \"params\")",
    "ts.call(g)",
    "a function has no property \"params\"",
  ),
]

const evidenceSource = readFileSync("tests/ffi-evidence.test.ts", "utf8")
const evidenceSeeds: MutationSeed[] = [...evidenceSource.matchAll(/(\/\/ @ts-expect-error ([^\n]+))\n([^\n]+)/g)].flatMap((match, index) => {
  const directive = match[1]!
  const operation = match[3]!.trim()
  return [
    {
      id: `evidence-diagnostic-${index}`,
      original: directive,
      replacement: "",
      diagnostics: [{ location: operation, code: operation.includes("<Guard,") ? 2558 : operation.startsWith("const ") ? 2322 : 2345 }],
    },
    unusedDirective(
      `evidence-repair-${index}`,
      operation,
      operation.startsWith("const ") ? `const ${operation.match(/^const (\w+)/)?.[1]} = 0` : "void 0",
      match[2]!,
    ),
  ]
})

const fixtures: Fixture[] = [
  { file: "tests/lang.test.ts", seeds: languageSeeds },
  { file: "tests/typescript.test.ts", seeds: typescriptSeeds },
  { file: "tests/ffi-evidence.test.ts", seeds: evidenceSeeds },
]
const dir = mkdtempSync(resolve(".denotation-contracts-"))
let succeeded = false
try {
  const config = join(dir, "tsconfig.json")
  writeFileSync(
    config,
    JSON.stringify({
      extends: "../tsconfig.json",
      compilerOptions: { composite: false, incremental: false, declaration: false },
      files: ["contract.ts"],
      include: [],
      exclude: [],
    }),
  )
  for (const { file: fixtureFile, seeds } of fixtures) {
    const fixture = readFileSync(fixtureFile, "utf8")
    for (const seed of [null, ...seeds]) {
      const source = (seed === null ? fixture : replaceOne(fixture, seed.original, seed.replacement))
        .replaceAll("from \"./", "from \"../tests/")
      writeFileSync(join(dir, "contract.ts"), source)
      const result = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", config, "--pretty", "false"], {
        encoding: "utf8",
        timeout: 120_000,
      })
      if (result.error) throw result.error
      const output = `${result.stdout}${result.stderr}`
      if (seed === null) {
        assert.equal(result.status, 0, `unchanged control of ${fixtureFile} failed\n${output}`)
      } else {
        const expected = seed.diagnostics.map(({ location, code }) => {
          assert.equal(source.split(location).length, 2, `${seed.id} assertion location must match once: ${location}`)
          const line = source.slice(0, source.indexOf(location)).split("\n").length
          return `${join(dir, "contract.ts")}:${line}:TS${code}`
        }).sort()
        assert.equal(result.status, 1, `${seed.id} must fail compilation\n${output}`)
        const diagnostics = [...output.matchAll(/^(?:(.+)\((\d+),\d+\): )?error TS(\d+):/gm)]
          .map((match): CompilerDiagnostic => {
            const code = match[3]
            assert.ok(code, "compiler diagnostic requires a code")
            return { file: match[1], line: match[2], code }
          })
          .map(({ file, line, code }) => `${file ? resolve(file) : "<global>"}:${line ?? 0}:TS${code}`)
          .sort()
        assert.deepEqual(diagnostics, expected, `${seed.id} caused unexpected diagnostics\n${output}`)
        console.log(`Detected ${seed.id} at its expected diagnostic contracts`)
      }
    }
  }
  succeeded = true
} finally {
  if (succeeded) rmSync(dir, { recursive: true, force: true })
  else console.error(`Retained failed control source at ${dir}`)
}
