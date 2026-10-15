import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { test } from "node:test"

import { c, emitC } from "../languages/c.ts"
import { emitTs, type Predicate, type TS, ts, tsTarget } from "../languages/typescript.ts"
import { children, type Expr, type Facts, type RuntimeType, walk } from "../src/lang/index.ts"
import { typecheck } from "./stage2.ts"

const fields = (type: RuntimeType): Record<string, unknown> => type as unknown as Record<string, unknown>

test("C expression evidence follows promotions and drives integer literal lowering", () => {
  const byte = c.literal(c.uint(8), 255)
  const sum = c.add(byte, byte)
  assert.equal(fields(sum.type).bits, 32)
  assert.equal(fields(sum.type).signed, true)
  const unsigned = c.add(sum, c.literal(c.uint(32), 1))
  assert.equal(fields(unsigned.type).bits, 32)
  assert.equal(fields(unsigned.type).signed, false)
  const wide = c.add(unsigned, c.literal(c.int(64), 1))
  assert.equal(fields(wide.type).bits, 64)
  assert.equal(fields(wide.type).signed, true)
  assert.equal(c.add(wide, c.literal(c.double, 1)).type, c.double)
  assert.equal(fields(c.less(byte, byte).type).bits, 32)

  const program = c.program(function*() {
    const minimum = yield* c.let("minimum", c.literal(c.int(32), -(2 ** 31)), c.int(32))
    const pointer = c.address(minimum)
    assert.equal(c.deref(pointer).type, minimum.type)
    yield* c.fn("promoted", [], c.int(32), function*() {
      yield* c.return(sum)
    })
    yield* c.let("large", c.literal(c.uint(64), 2 ** 32), c.uint(64))
  })
  const source = emitC(program)
  assert.equal(
    source,
    `#include <stdint.h>

int32_t minimum = INT32_MIN;
int32_t promoted(void) {
  return 255 + 255;
}
uint64_t large = UINT64_C(4294967296);
`,
  )
  const compiled = spawnSync("cc", ["-std=c11", "-Werror", "-x", "c", "-fsyntax-only", "-"], { input: source, encoding: "utf8" })
  assert.equal(compiled.status, 0, compiled.stderr)
})

test("TypeScript construction keeps widening and branch refinements symbolic", () => {
  const program = ts.program(function*() {
    const value = yield* ts.let("value", ts.literal("text"))
    assert.equal(value.type.kind, "widen")
    const declared = ts.union(ts.string, ts.number)
    const input = yield* ts.let("input", value, declared)
    assert.equal(input.type, declared)
    yield* ts.if(ts.typeOf(input, "string"), function*(text) {
      assert.equal(text.type.kind, "refinement")
      assert.equal(fields(text.type).base, declared)
      assert.equal(fields(text.type).side, "then")
      yield* ts.assign(text, ts.literal(1))
    }, function*(number) {
      assert.equal(fields(number.type).side, "else")
    })
  })
  walk(program.root, (node) => {
    if (node.role === "expr") assert.ok((node as unknown as Expr<unknown, unknown, Facts>).type)
  })
})

test("predicate callable results survive properties, returned functions, and alias environments", () => {
  const program = ts.program(function*() {
    const Guard = yield* ts.alias("Guard", [ts.typeParam("T")], (T) => ts.functionType([ts.unknown], ts.predicate(0, T)))
    const isText = ts.hostValue("isText", Guard(ts.string))
    const factory = ts.hostValue("factory", ts.functionType([], Guard(ts.string)))
    const object = ts.hostValue("guards", ts.object({ isText: Guard(ts.string) }))
    const Guards = yield* ts.alias(
      "Guards",
      [ts.typeParam("T")],
      (T) => ts.mapped("K", ts.keyof(T), (K) => ts.functionType([ts.unknown], ts.predicate(0, ts.index(T, K)))),
    )
    const mapped = ts.hostValue("mapped", Guards(ts.object({ text: ts.string })))
    yield* ts.fn("check", [ts.param("input", ts.unknown)], ts.void, function*(input) {
      yield* ts.run(ts.call(ts.get(mapped, "text"), input))
      const alias = yield* ts.let("alias", isText)
      const declared = yield* ts.let("declared", alias, Guard(ts.string))
      yield* ts.assign(declared, ts.get(object, "isText"))
      const callees: Expr<TS, (input: unknown) => boolean & Predicate<0, string>, { readonly kind: keyof typeof tsTarget.handlers }, "complete">[] = [
        alias,
        declared,
        ts.get(object, "isText"),
        ts.call(factory),
      ]
      for (const callee of callees) {
        const condition = ts.call(callee, input)
        assert.ok(condition.type)
        assert.equal((condition as unknown as { narrows: unknown }).narrows, input.binding)
        yield* ts.if(condition, function*(text) {
          assert.equal(text.type.kind, "refinement")
          yield* ts.let("text", text, ts.string)
        })
      }
    })
  })
  const source = emitTs(program)
  assert.equal(
    typecheck([`declare const isText: (input: unknown) => input is string;
declare const factory: () => (input: unknown) => input is string;
declare const guards: { isText: (input: unknown) => input is string };
declare const mapped: { text: (input: unknown) => input is string };
${source}`]),
    "",
  )
})

test("host witnesses are metadata, scoped but not emitted or syntax children", () => {
  const witness = ts.functionType([ts.number], ts.string)
  const host = ts.hostValue("format", witness)
  assert.equal(host.type, witness)
  assert.deepEqual(children(host), [])
  let escaped: typeof witness | undefined
  ts.program(function*() {
    yield* ts.alias("Capture", [ts.typeParam("T")], (T) => {
      escaped = T as unknown as typeof witness
      return T
    })
  })
  assert.throws(() =>
    ts.program(function*() {
      yield* ts.run(ts.hostValue("escaped", escaped!))
    }), /in-scope binding/)
  const program = ts.program(function*() {
    const Mapped = ts.mapped("K", ts.union(ts.literalType("a"), ts.literalType("b")), () => ts.number)
    yield* ts.run(ts.hostValue("one", Mapped))
    yield* ts.run(ts.hostValue("two", Mapped))
  })
  assert.equal(emitTs(program), "one;\ntwo;")
})

test("open conditional callable selection has an explicit supported-operation diagnostic", () => {
  const conditional = ts.conditional(ts.string, ts.string, ts.functionType([], ts.string), ts.functionType([], ts.string))
  assert.equal(conditional.kind, "conditional-type")
  assert.equal(ts.call(ts.hostValue("conditional", conditional)).type.role, "unavailable")
})
