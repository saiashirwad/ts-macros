import assert from "node:assert/strict"
import test from "node:test"
import { emitTs, type Predicate, type TS, ts } from "../languages/typescript.ts"
import type { Denotes, Equal, EvidenceOf, Expr, Facts, ProgramFactsOf, StaticEvidence } from "../src/lang/index.ts"

const assertType = <_T extends true>() => {}

const guardType = ts.functionType([ts.unknown], ts.predicate(0, ts.string))
type Guard = (input: unknown) => boolean & Predicate<0, string>

type CleanBooleanFunction = import("../src/lang/index.ts").Ref<
  TS,
  import("../src/lang/index.ts").Signature<readonly [], boolean>,
  import("../src/lang/index.ts").Signature<readonly [], boolean>,
  { readonly kind: "ref" },
  "complete"
>

export const evidenceControls = () => {
  const opaque = ts.hostValue<Guard>("isText")
  const known = ts.hostValue("isText", guardType)
  assertType<Equal<EvidenceOf<typeof opaque>, "unavailable">>()
  assertType<Equal<EvidenceOf<typeof known>, "complete">>()
  const broad: Expr<TS, Guard> = opaque
  const factBroad: Expr<TS, Guard, Facts> = known
  ts.program(function*() {
    const value = yield* ts.let("value", ts.hostValue<unknown>("input"))
    const aliased = yield* ts.let("aliased", opaque)
    const annotated = yield* ts.let("annotated", opaque, guardType)
    const washed = yield* ts.let("washed", broad)
    const witnessed = yield* ts.let("witnessed", known)
    const symbolicAnnotation = yield* ts.let("symbolicAnnotation", known, ts.conditional(ts.string, ts.string, guardType, guardType))
    // @ts-expect-error symbolic annotations cannot retain concrete initializer evidence
    yield* ts.if(ts.call(symbolicAnnotation, value), function*(_text) {})
    const unionAnnotation = yield* ts.let("unionAnnotation", known, ts.union(guardType, guardType))
    // @ts-expect-error union annotations cannot retain concrete initializer evidence
    yield* ts.if(ts.call(unionAnnotation, value), function*(_text) {})
    assertType<Equal<EvidenceOf<typeof aliased>, "unavailable">>()
    assertType<Equal<EvidenceOf<typeof annotated>, "unavailable">>()
    assertType<Equal<EvidenceOf<typeof washed>, "complete" | "symbolic" | "unavailable">>()
    // @ts-expect-error opaque predicates do not grant narrowing
    yield* ts.if(ts.call(opaque, value), function*(_text) {})
    // @ts-expect-error aliases do not grant narrowing
    yield* ts.if(ts.call(aliased, value), function*(_text) {})
    // @ts-expect-error annotations do not grant narrowing
    yield* ts.if(ts.call(annotated, value), function*(_text) {})
    // @ts-expect-error broad facts do not grant narrowing
    yield* ts.if(ts.call(factBroad, value), function*(_text) {})
    // @ts-expect-error assignment cannot forge a stable witness
    yield* ts.assign(witnessed, opaque)
    const property = ts.get(ts.hostValue<{ guard: Guard }>("holder"), "guard")
    assertType<Equal<EvidenceOf<typeof property>, "unavailable">>()
    // @ts-expect-error properties retain missing evidence
    yield* ts.if(ts.call(property, value), function*(_text) {})
    const plain = ts.hostValue("isTrue", ts.functionType([ts.unknown], ts.boolean))
    // @ts-expect-error plain boolean callables cannot acquire a predicate annotation
    yield* ts.let("forged", plain, guardType)
    // @ts-expect-error assignment cannot upgrade plain boolean callables to predicates
    yield* ts.assign(witnessed, plain)
    const plainObject = ts.hostValue("plainObject", ts.object({ guard: ts.functionType([ts.unknown], ts.boolean) }))
    // @ts-expect-error nested properties cannot upgrade plain boolean callables to predicates
    yield* ts.let("forgedObject", plainObject, ts.object({ guard: guardType }))
    const identity = yield* ts.fn("identity", [ts.param("guard", guardType)], guardType, function*(guard) {
      yield* ts.return(guard)
    })
    // @ts-expect-error higher order arguments cannot forge witnesses
    ts.call(identity, opaque)
    // @ts-expect-error higher order boolean callables cannot acquire predicate returns
    ts.call(identity, plain)
    const erased = yield* ts.let("erased", ts.call(known, value), ts.boolean)
    // @ts-expect-error boolean annotation erases predicate narrowing
    yield* ts.if(erased, function*(_text) {})
    const hidden = yield* ts.fn("hidden", [], guardType, function*() {
      yield* ts.return(opaque)
    })
    assertType<Equal<EvidenceOf<typeof hidden>, "unavailable">>()
    const returned = ts.call(hidden)
    assertType<Equal<EvidenceOf<typeof returned>, "unavailable">>()
    // @ts-expect-error opaque function bodies remain dependencies of returned callables
    yield* ts.if(ts.call(returned, value), function*(_text) {})
  })
  // @ts-expect-error run cannot erase evidence with partial explicit generics
  ts.run<Guard, { readonly kind: "host-value" }>(opaque)
  // @ts-expect-error return cannot erase evidence with partial explicit generics
  ts.return<Guard, { readonly kind: "host-value" }>(opaque)
  const union = ts.hostValue("union", ts.union(guardType, guardType))
  ts.program(function*() {
    const value = yield* ts.let("value", ts.hostValue<unknown>("input"))
    // @ts-expect-error union callable selection cannot grant narrowing
    yield* ts.if(ts.call(union, value), function*(_text) {})
    yield* ts.if(ts.equals(value, ts.literal("text")), function*(equal) {
      assertType<Equal<EvidenceOf<typeof equal>, "unavailable">>()
    })
  })
  // @ts-expect-error statement facts cannot wash unavailable evidence
  const statement: import("../src/lang/index.ts").Stmt<TS, { readonly kind: "expression" | "host-value" }> = ts.run(opaque)
  void statement
  const conditionalType = ts.conditional(ts.string, ts.string, guardType, guardType)
  // @ts-expect-error type annotations cannot wash symbolic evidence
  const washedType: import("../src/lang/index.ts").TypeNode<TS, Guard, { readonly kind: "function-type" }> = conditionalType
  void washedType
  const flag: Expr<TS, boolean, { readonly kind: "host-value"; readonly runtime: "unavailable" }, "unavailable"> = ts.hostValue<boolean>("flag")
  const ifProgram = ts.program(function*() {
    yield* ts.if(flag, function*() {})
  })
  // @ts-expect-error if conditions retain honest evidence when facts are annotated
  ts.completeTypes(ifProgram, () => {})
  const notProgram = ts.program(function*() {
    yield* ts.run(ts.not(flag))
  })
  // @ts-expect-error negation retains honest evidence when facts are annotated
  ts.completeTypes(notProgram, () => {})
  const equalityProgram = ts.program(function*() {
    yield* ts.run(ts.equals(flag, ts.literal(true)))
  })
  // @ts-expect-error equality operands retain honest evidence when facts are annotated
  ts.completeTypes(equalityProgram, () => {})
  const callProgram = ts.program(function*() {
    yield* ts.run(ts.call(ts.hostValue("accept", ts.functionType([ts.boolean], ts.void)), flag))
  })
  // @ts-expect-error call arguments retain honest evidence when facts are annotated
  ts.completeTypes(callProgram, () => {})
  ts.program(function*() {
    const target: import("../src/lang/index.ts").Ref<
      TS,
      boolean,
      boolean,
      { readonly kind: "ref" } | { readonly kind: "host-value"; readonly runtime: "unavailable" },
      "unavailable"
    > = yield* ts.let(
      "target",
      flag,
    )
    const assignment = ts.assign(target, ts.literal(true))
    const assignmentProgram = ts.program(function*() {
      yield* assignment
    })
    // @ts-expect-error assignment targets retain honest evidence when facts are annotated
    ts.completeTypes(assignmentProgram, () => {})
  })
  const localComplete = ts.call(ts.hostValue("consume", ts.functionType([ts.number], ts.boolean)), ts.hostValue<number>("input"))
  assertType<Equal<EvidenceOf<typeof localComplete>, "complete">>()
  // @ts-expect-error local complete evidence cannot wash transitive unavailable facts
  const washedResult: Expr<TS, boolean, { readonly kind: "call" | "host-value" | "function-type" | "primitive-type" }, "complete"> = localComplete
  void washedResult
  ts.program(function*() {
    const fn = yield* ts.fn("symbolicBody", [], ts.boolean, function*() {
      yield* ts.run(ts.hostValue("symbolic", ts.union(ts.string, ts.number)))
      yield* ts.return(ts.literal(true))
    })
    assertType<Equal<EvidenceOf<typeof fn>, "complete">>()
    // @ts-expect-error local complete function evidence cannot wash symbolic body dependencies
    const washedFunction: CleanBooleanFunction = fn
    void washedFunction
  })
  const incomplete = ts.program(function*() {
    yield* ts.run(opaque)
  })
  // @ts-expect-error a complete pass rejects an unavailable program
  ts.completeTypes(incomplete, () => {})
  const symbolic = ts.conditional(ts.string, ts.string, guardType, guardType)
  const conditional = ts.hostValue("conditional", symbolic)
  assertType<Equal<EvidenceOf<typeof conditional>, "symbolic">>()
  ts.program(function*() {
    const value = yield* ts.let("value", ts.literal("text"), ts.unknown)
    // @ts-expect-error symbolic predicates cannot grant narrowing
    yield* ts.if(ts.call(conditional, value), function*(_text) {})
    const mapped = ts.hostValue("mapped", ts.mapped("K", ts.literalType("guard"), () => guardType))
    // @ts-expect-error mapped predicate selection is conservatively symbolic
    yield* ts.if(ts.call(ts.get(mapped, "guard"), value), function*(_text) {})
    const intersection = ts.hostValue("intersection", ts.functionType([ts.unknown], ts.intersection(ts.boolean, ts.predicate(0, ts.string))))
    // @ts-expect-error boolean intersections do not grant runtime predicate selection
    yield* ts.if(ts.call(intersection, value), function*(_text) {})
  })
}

test("opaque Console calls emit without a hand-written model", () => {
  const console = ts.hostValue<Console>("console")
  const log = ts.get(console, "log")
  const call = ts.call(log, ts.literal("hello"))
  assertType<Equal<Denotes<typeof call>, void>>()
  assertType<Equal<EvidenceOf<typeof call>, "unavailable">>()
  assert.equal(console.type.role, "unavailable")
  assert.equal(log.type.role, "unavailable")
  assert.equal(call.type.role, "unavailable")
  assert.notEqual(ts.unknown.kind, console.type.kind)
  assert.equal(
    emitTs(ts.program(function*() {
      yield* ts.run(call)
    })),
    "console.log(\"hello\");",
  )
})

test("local witnessed narrowing executes in a program with opaque dependencies", () => {
  const program = ts.program(function*() {
    yield* ts.run(ts.hostValue<Console>("console"))
    const value = yield* ts.let("value", ts.hostValue<unknown>("input"))
    const isText = ts.hostValue("isText", guardType)
    const result = ts.call(isText, value)
    assertType<Equal<EvidenceOf<typeof result>, "complete">>()
    yield* ts.if(result, function*(text) {
      assertType<Equal<Denotes<typeof text>, string>>()
      assertType<Equal<EvidenceOf<typeof text>, "complete">>()
      yield* ts.run(ts.call(ts.hostValue("record", ts.functionType([ts.string], ts.void)), ts.call(ts.get(text, "toUpperCase"))))
    })
  })
  assertType<Equal<StaticEvidence<ProgramFactsOf<typeof program>>, "unavailable">>()
  const values: string[] = []
  new Function("input", "isText", "record", emitTs(program))(
    "hello",
    (value: unknown) => typeof value === "string",
    (value: string) => values.push(value),
  )
  assert.deepEqual(values, ["HELLO"])
})

test("a complete pass visits witnessed runtime expression types", () => {
  const program = ts.program(function*() {
    yield* ts.run(ts.call(ts.hostValue("format", ts.functionType([ts.number], ts.string)), ts.literal(1)))
  })
  const kinds: string[] = []
  ts.completeTypes(program, (type) => kinds.push(type.kind))
  assert.deepEqual(kinds, ["primitive-type", "function-type", "literal-type"])
})

test("typeof derives primitive evidence from an opaque subject", () => {
  const program = ts.program(function*() {
    const value = yield* ts.let("value", ts.hostValue<unknown>("input"))
    yield* ts.if(ts.typeOf(value, "string"), function*(text) {
      assertType<Equal<EvidenceOf<typeof text>, "complete">>()
      yield* ts.run(ts.call(ts.hostValue("record", ts.functionType([ts.string], ts.void)), ts.call(ts.get(text, "trim"))))
    })
  })
  const values: string[] = []
  new Function("input", "record", emitTs(program))(" hello ", (value: string) => values.push(value))
  assert.deepEqual(values, ["hello"])
})

test("typeof on witnessed unknown supports a complete runtime pass", () => {
  const program = ts.program(function*() {
    const value = yield* ts.let("value", ts.hostValue("input", ts.unknown))
    yield* ts.if(ts.typeOf(value, "string"), function*(text) {
      const trimmed = ts.call(ts.get(text, "trim"))
      assert.equal(trimmed.type, ts.string)
      yield* ts.run(trimmed)
    })
  })
  ts.completeTypes(program, (type) => assert.notEqual(type.role, "unavailable"))
})
