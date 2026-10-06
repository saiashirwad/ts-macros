import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { emitProgram as emitJavaScript } from "../targets/js.ts"
import { emitProgram } from "../targets/ts.ts"

const evaluated = (value: $.Expr<any>): unknown => {
  const program = $.build(function*() {
    yield* $.const("result", value)
    return null
  })
  const javascript = emitJavaScript(program)
  return new Function(`${javascript}\nreturn result`)()
}

test("a program without type annotations emits identical TypeScript and JavaScript", () => {
  const program = $.build(function*() {
    yield* $.const("result", $.add($.number(1), $.number(2)))
    return null
  })
  assert.equal(emitJavaScript(program), emitProgram(program))
})

test("a numeric literal can be the receiver of a member access", () => {
  assert.equal(evaluated($.call($.prop($.number(1), "toFixed"))), "1")
  assert.equal(evaluated($.call($.prop($.number(-1), "toFixed"))), "-1")
  assert.equal(evaluated($.binary("-", $.number(2), $.number(-1))), 3)
})

test("numeric expressions preserve signed zero and reject non-finite values", () => {
  assert.equal(Object.is(evaluated($.number(-0)), -0), true)
  assert.throws(() => $.number(NaN), /expression number must be finite, got NaN/)
  assert.throws(() => $.number(Infinity), /expression number must be finite, got Infinity/)
  assert.throws(() => $.number(-Infinity), /expression number must be finite, got -Infinity/)
  assert.throws(() => $.lift(NaN), /expression number must be finite, got NaN/)
  assert.throws(() => $.lift([Infinity]), /expression number must be finite, got Infinity/)
})

test("operators group the way the tree does, not the way the text reads", () => {
  const two = $.number(2)
  assert.equal(evaluated($.binary("*", $.binary("+", two, two), two)), 8)
  assert.equal(evaluated($.binary("-", two, $.binary("-", two, two))), 2)
  assert.equal(evaluated($.unary("!", $.binary("===", two, two))), false)
  assert.equal(evaluated($.binary("+", $.cond($.boolean(true), two, two), two)), 4)
})

test("unary expressions parenthesize leading-negative numeric forms", () => {
  assert.equal(evaluated($.unary("!", $.number(-1))), false)
  assert.equal(evaluated($.unary("!", $.number(-0))), true)
  assert.equal(evaluated($.unary("typeof", $.number(-1))), "number")
  assert.equal(evaluated($.unary("typeof", $.number(-0))), "number")
})

test("a template part is the string it produces, whatever it contains", () => {
  const part = "a`b${c}\\d"
  assert.equal(evaluated($.template([part, "!"], $.number(1))), `${part}1!`)
})

test("arrays, objects, indexing, and logical expressions preserve their values", () => {
  assert.deepEqual(evaluated($.object({ value: $.array($.number(1), $.number(2)) })), { value: [1, 2] })
  assert.equal(evaluated($.index($.array($.string("first"), $.string("second")), $.number(1))), "second")
  assert.equal(evaluated($.binary("&&", $.boolean(true), $.boolean(false))), false)
  assert.equal(evaluated($.binary("||", $.boolean(false), $.boolean(true))), true)
})

test("a template checks its arity at construction", () => {
  assert.throws(() => $.template(["a", "b", "c"], $.number(1)), /needs 2 parts, got 3/)
})

test("imports and globals cannot share an emitted name", () => {
  const imported = $.hostImport<{ readonly value: string }>("external-package", "shared")
  const global = $.hostValue<{ readonly value: string }>("shared")
  const program = $.build(function*() {
    yield* $.if($.boolean(true), function*() {
      yield* $.do($.prop(imported, "value"))
    })
    yield* $.do($.call($.arrow({
      body: function*() {
        return $.prop(global, "value")
      },
    })))
    return null
  })

  for (const emit of [emitProgram, emitJavaScript]) {
    assert.throws(() => emit(program), /external name "shared" refers to both an import and a global/)
  }
})

test("repeated imports and globals with unambiguous names are allowed", () => {
  const imported = $.hostImport<{ readonly first: number; readonly second: number }>("external-package", "shared")
  const repeatedImport = $.hostImport<{ readonly first: number; readonly second: number }>("external-package", "shared")
  const global = $.hostValue<{ readonly value: number }>("hostValue")
  const repeatedGlobal = $.hostValue<{ readonly value: number }>("hostValue")
  const program = $.build(function*() {
    yield* $.do($.prop(imported, "first"))
    yield* $.do($.prop(repeatedImport, "second"))
    yield* $.do($.prop(global, "value"))
    yield* $.do($.prop(repeatedGlobal, "value"))
    return null
  })

  assert.equal(
    emitProgram(program),
    `import * as shared from "external-package";\nshared.first;\nshared.second;\nhostValue.value;\nhostValue.value;`,
  )
})

test("a reserved word is a fine property name and an invalid binding name", () => {
  const property = $.build(function*() {
    yield* $.do($.prop($.hostValue<{ default: number }>("mod"), "default"))
    return null
  })
  const binding = $.build(function*() {
    yield* $.const("class", $.number(1))
    return null
  })
  for (const emit of [emitProgram, emitJavaScript]) {
    assert.equal(emit(property), "mod.default;")
    assert.throws(() => emit(binding), /cannot emit invalid identifier "class"/)
  }
})

test("a negative literal type is spelled with its sign", () => {
  const program = $.build(function*() {
    yield* $.type("Below", $.Union($.Literal(-1), $.Literal(0)))
    return null
  })
  assert.equal(emitProgram(program), "type Below = -1 | 0;")
})

test("both targets emit __proto__ as an own data property", () => {
  const value = evaluated($.object({ ["__proto__"]: 42, normal: "yes" }))
  assert.equal(Object.hasOwn(value as object, "__proto__"), true)
  assert.equal(Object.getOwnPropertyDescriptor(value, "__proto__")?.value, 42)
  assert.equal(Object.getPrototypeOf(value), Object.prototype)
})
