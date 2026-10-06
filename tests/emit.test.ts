import assert from "node:assert/strict"
import { test } from "node:test"

import * as T from "../src/index.ts"
import { emitProgram as emitJavaScript } from "../targets/js.ts"
import { emitProgram } from "../targets/ts.ts"

const evaluated = (value: T.Expr<any>): unknown => {
  const program = T.build(function*() {
    yield* T.const("result", value)
    return null
  })
  const javascript = emitJavaScript(program)
  return new Function(`${javascript}\nreturn result`)()
}

test("a program without type annotations emits identical TypeScript and JavaScript", () => {
  const program = T.build(function*() {
    yield* T.const("result", T.add(T.numberLiteral(1), T.numberLiteral(2)))
    return null
  })
  assert.equal(emitJavaScript(program), emitProgram(program))
})

test("a numeric literal can be the receiver of a member access", () => {
  assert.equal(evaluated(T.call(T.prop(T.numberLiteral(1), "toFixed"))), "1")
  assert.equal(evaluated(T.call(T.prop(T.numberLiteral(-1), "toFixed"))), "-1")
  assert.equal(evaluated(T.binary("-", T.numberLiteral(2), T.numberLiteral(-1))), 3)
})

test("numeric expressions preserve signed zero and reject non-finite values", () => {
  assert.equal(Object.is(evaluated(T.numberLiteral(-0)), -0), true)
  assert.throws(() => T.numberLiteral(NaN), /expression number must be finite, got NaN/)
  assert.throws(() => T.numberLiteral(Infinity), /expression number must be finite, got Infinity/)
  assert.throws(() => T.numberLiteral(-Infinity), /expression number must be finite, got -Infinity/)
  assert.throws(() => T.lift(NaN), /expression number must be finite, got NaN/)
  assert.throws(() => T.lift([Infinity]), /expression number must be finite, got Infinity/)
})

test("operators group the way the tree does, not the way the text reads", () => {
  const two = T.numberLiteral(2)
  assert.equal(evaluated(T.binary("*", T.binary("+", two, two), two)), 8)
  assert.equal(evaluated(T.binary("-", two, T.binary("-", two, two))), 2)
  assert.equal(evaluated(T.unary("!", T.binary("===", two, two))), false)
  assert.equal(evaluated(T.binary("+", T.cond(T.booleanLiteral(true), two, two), two)), 4)
})

test("unary expressions parenthesize leading-negative numeric forms", () => {
  assert.equal(evaluated(T.unary("!", T.numberLiteral(-1))), false)
  assert.equal(evaluated(T.unary("!", T.numberLiteral(-0))), true)
  assert.equal(evaluated(T.unary("typeof", T.numberLiteral(-1))), "number")
  assert.equal(evaluated(T.unary("typeof", T.numberLiteral(-0))), "number")
})

test("a template part is the string it produces, whatever it contains", () => {
  const part = "a`b${c}\\d"
  assert.equal(evaluated(T.template([part, "!"], T.numberLiteral(1))), `${part}1!`)
})

test("arrays, objects, indexing, and logical expressions preserve their values", () => {
  assert.deepEqual(evaluated(T.objectLiteral({ value: T.arrayLiteral(T.numberLiteral(1), T.numberLiteral(2)) })), { value: [1, 2] })
  assert.equal(evaluated(T.index(T.arrayLiteral(T.stringLiteral("first"), T.stringLiteral("second")), T.numberLiteral(1))), "second")
  assert.equal(evaluated(T.binary("&&", T.booleanLiteral(true), T.booleanLiteral(false))), false)
  assert.equal(evaluated(T.binary("||", T.booleanLiteral(false), T.booleanLiteral(true))), true)
})

test("a template checks its arity at construction", () => {
  assert.throws(() => T.template(["a", "b", "c"], T.numberLiteral(1)), /needs 2 parts, got 3/)
})

test("imports and globals cannot share an emitted name", () => {
  const imported = T.hostImport<{ readonly value: string }>("external-package", "shared")
  const global = T.hostValue<{ readonly value: string }>("shared")
  const program = T.build(function*() {
    yield* T.if(T.booleanLiteral(true), function*() {
      yield* T.do(T.prop(imported, "value"))
    })
    yield* T.do(T.call(T.arrow({
      body: function*() {
        return T.prop(global, "value")
      },
    })))
    return null
  })

  for (const emit of [emitProgram, emitJavaScript]) {
    assert.throws(() => emit(program), /external name "shared" refers to both an import and a global/)
  }
})

test("repeated imports and globals with unambiguous names are allowed", () => {
  const imported = T.hostImport<{ readonly first: number; readonly second: number }>("external-package", "shared")
  const repeatedImport = T.hostImport<{ readonly first: number; readonly second: number }>("external-package", "shared")
  const global = T.hostValue<{ readonly value: number }>("hostValue")
  const repeatedGlobal = T.hostValue<{ readonly value: number }>("hostValue")
  const program = T.build(function*() {
    yield* T.do(T.prop(imported, "first"))
    yield* T.do(T.prop(repeatedImport, "second"))
    yield* T.do(T.prop(global, "value"))
    yield* T.do(T.prop(repeatedGlobal, "value"))
    return null
  })

  assert.equal(
    emitProgram(program),
    `import * as shared from "external-package";\nshared.first;\nshared.second;\nhostValue.value;\nhostValue.value;`,
  )
})

test("a reserved word is a fine property name and an invalid binding name", () => {
  const property = T.build(function*() {
    yield* T.do(T.prop(T.hostValue<{ default: number }>("mod"), "default"))
    return null
  })
  const binding = T.build(function*() {
    yield* T.const("class", T.numberLiteral(1))
    return null
  })
  for (const emit of [emitProgram, emitJavaScript]) {
    assert.equal(emit(property), "mod.default;")
    assert.throws(() => emit(binding), /cannot emit invalid identifier "class"/)
  }
})

test("a negative literal type is spelled with its sign", () => {
  const program = T.build(function*() {
    yield* T.type("Below", T.Union(T.Literal(-1), T.Literal(0)))
    return null
  })
  assert.equal(emitProgram(program), "type Below = -1 | 0;")
})

test("both targets emit __proto__ as an own data property", () => {
  const value = evaluated(T.objectLiteral({ ["__proto__"]: 42, normal: "yes" }))
  assert.equal(Object.hasOwn(value as object, "__proto__"), true)
  assert.equal(Object.getOwnPropertyDescriptor(value, "__proto__")?.value, 42)
  assert.equal(Object.getPrototypeOf(value), Object.prototype)
})
