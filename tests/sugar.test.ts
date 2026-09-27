import assert from "node:assert/strict"
import { test } from "node:test"

import type { Guard } from "../src/check.ts"
import { Decl, Expr, FFI, Program, Stmt, Type } from "../src/index.ts"
import { expectTypeOf } from "./typing.ts"

type FnReturn<Declared, Final, Yields> = unknown extends Declared ? Expr.Denotes<Expr.Lift<Final> | Stmt.ReturnValue<Yields>> : Declared

/** `Decl.fn` intersects a rest-style `CheckLift` onto the spec, which blocks inference. */
const fn = Decl.fn as <
  const Params extends Expr.AnyParams = [],
  Declared = unknown,
  const TypeParams extends Type.AnyParams = [],
  Yields extends Stmt.NonLoopStatement = never,
  Final = unknown,
>(
  name: string,
  spec:
    & Omit<Decl.FnSpec<Params, Declared, TypeParams, Yields, Final>, "params">
    & {
      readonly params?: Params & Guard<Expr.CheckParams<Params>>
    }
    & (unknown extends Declared ? unknown
      : [Expr.Denotes<Stmt.ReturnValue<Yields>>] extends [Declared] ? unknown : ["early returns do not satisfy the declared return type"])
    & (unknown extends Declared ? unknown : [Expr.Value<Final>] extends [Declared] ? unknown : ["the returned value is not assignable"]),
) => Decl.FunctionBuilder<Params, FnReturn<Declared, Final, Yields>, TypeParams>

type AnyNode = { readonly kind: string; readonly [key: string]: any }
const asNode = (x: any): AnyNode => Expr.lift(x as never) as unknown as AnyNode

interface Fs {
  readFileSync(path: string): string
}

test("lift lifts primitives to literal nodes, and says so in its type", () => {
  const n = Expr.lift(2)
  expectTypeOf<typeof n>(null as any).toEqualTypeOf<Expr.Literal<2>>()
  assert.equal(asNode(n).kind, "literal")
  assert.equal(asNode(n).value, 2)
  assert.equal((asNode(n).type as Type.Any)?.kind, "literal")

  const s = Expr.lift("hi")
  expectTypeOf<typeof s>(null as any).toEqualTypeOf<Expr.Literal<"hi">>()
  assert.equal(asNode(s).value, "hi")
  assert.equal((asNode(s).type as Type.Any)?.kind, "literal")

  const b = Expr.lift(true)
  expectTypeOf<typeof b>(null as any).toEqualTypeOf<Expr.Literal<true>>()
  assert.equal(asNode(b).value, true)
  assert.equal((asNode(b).type as Type.Any)?.kind, "literal")
})

test("lift lifts arrays and plain objects recursively, preserving structure", () => {
  const arr = Expr.lift([1, "a"])
  expectTypeOf<Expr.Denotes<typeof arr>>(null as any).toEqualTypeOf<(string | number)[]>()
  assert.equal((asNode(arr).type as Type.Any)?.kind, "array")
  const elements = asNode(arr).elements as AnyNode[]
  assert.deepEqual(elements.map((e) => e.kind), ["literal", "literal"])

  const obj = Expr.lift({ x: 1, nested: { s: "a" } })
  expectTypeOf<Expr.Denotes<typeof obj>>(null as any).toEqualTypeOf<{ x: 1; nested: { s: "a" } }>()
  const fields = asNode(obj).fields as Record<string, AnyNode>
  assert.equal(fields["x"]!.kind, "literal")
  assert.equal(fields["nested"]!.kind, "object")
})

test("lift passes nodes through unchanged", () => {
  const node = Expr.number(2)
  assert.equal(Expr.lift(node), node)
})

test("lift rejects unsupported objects and fields without invoking accessors", () => {
  assert.throws(() => Expr.lift((() => {}) as any), /cannot lift function/)
  assert.throws(() => Expr.lift(null as any), /cannot lift null/)
  assert.throws(() => Expr.lift(undefined as any), /cannot lift undefined/)
  assert.throws(() => Expr.lift(new Date() as any), /fields must be a plain object literal with Object\.prototype/)
  assert.throws(() => Expr.lift(Object.create(null) as any), /fields must be a plain object literal with Object\.prototype/)

  class RecordClass {
    value = 1
  }
  assert.throws(() => Expr.lift(new RecordClass() as any), /fields must be a plain object literal with Object\.prototype/)
  const badProto = Object.create({ foo: 1 })
  assert.throws(() => Expr.lift(badProto), /fields must be a plain object literal with Object\.prototype/)

  const symbol = Symbol("hidden")
  const symbolFields = { visible: 1, [symbol]: 2 }
  const rejectSymbolFields = () => {
    // @ts-expect-error - Expr.object cannot represent symbol-keyed fields
    Expr.lift(symbolFields)
  }
  void rejectSymbolFields
  assert.throws(() => Expr.lift(symbolFields as any), /fields must not have symbol keys/)

  const nonEnumerable = { visible: 1 }
  Object.defineProperty(nonEnumerable, "hidden", { value: 2, enumerable: false })
  assert.throws(() => Expr.lift(nonEnumerable), /field "hidden" must be enumerable/)

  let reads = 0
  const accessor = Object.defineProperty({ visible: 1 }, "computed", {
    enumerable: true,
    get() {
      reads++
      return 2
    },
  })
  assert.throws(() => Expr.lift(accessor), /field "computed" must be a data property, not an accessor/)
  assert.equal(reads, 0)
})

test("lift rejects unique symbol brands and accepts ordinary nested records", () => {
  const brand: unique symbol = Symbol("brand")
  type Branded = { value: number; [brand]: true }
  const branded: Branded = { value: 1, [brand]: true }
  expectTypeOf<Expr.Lift<Branded>>(undefined as never).toEqualTypeOf<never>()
  expectTypeOf<Expr.Lift<{ [key: symbol]: number }>>(undefined as never).toEqualTypeOf<never>()

  const rejectBranded = () => {
    // @ts-expect-error - unique symbol brands cannot be represented by Expr.object
    Expr.lift(branded)
  }
  void rejectBranded

  const ordinary = {
    user: { name: "Ada" as string, flags: { active: true as boolean } },
    count: 1 as number,
  }
  const lifted = Expr.lift(ordinary)
  expectTypeOf<Expr.Denotes<typeof lifted>>(null as any).toEqualTypeOf<typeof ordinary>()
  assert.equal(asNode(lifted).kind, "object")
})

test("call lifts its arguments and builds a Call node", () => {
  const fs = FFI.Import<Fs>("node:fs", "fs")
  const read = Expr.call(Expr.prop(fs, "readFileSync"), "/tmp/a")
  expectTypeOf<Expr.Denotes<typeof read>>(null as any).toEqualTypeOf<string>()
  assert.equal(read.kind, "call")
  assert.equal(asNode(read.callee).key, "readFileSync")
  assert.equal(read.args.length, 1)
  assert.equal(asNode(read.args[0]).kind, "literal")
  assert.equal(asNode(read.args[0]).value, "/tmp/a")
})

test("call checks its arguments against the callee", () => {
  const floor = FFI.Value<(x: number) => number>("floor")
  Expr.call(floor, 1.5)
  Expr.call(floor, Expr.number(1.5))
  // @ts-expect-error - a string does not lift to Expr<number>
  Expr.call(floor, "no")
  // @ts-expect-error - missing the argument
  Expr.call(floor)
  // @ts-expect-error - a number is not callable
  Expr.call(Expr.number(1))
})

test("call reaches the methods of a primitive", () => {
  const shout = Expr.call(Expr.prop(Expr.string("hi"), "toUpperCase"))
  expectTypeOf<Expr.Denotes<typeof shout>>(null as any).toEqualTypeOf<string>()
  assert.equal(asNode(shout.callee).key, "toUpperCase")
})

test("a plain object is not a node", () => {
  // @ts-expect-error - a node carries a brand only the constructors can give it
  const forged: Expr.Expr<number> = { kind: "literal", value: 1 }
  void forged
})

test("a plain function does not lift", () => {
  // @ts-expect-error - only values lift; a function would have to be a node
  assert.throws(() => Expr.add(() => 1, 1), /cannot lift function/)
})

test("operators build Binary nodes from mixed raw and node args", () => {
  const something = Expr.number(5)
  const sum = Expr.add(2, something)
  expectTypeOf<Expr.Denotes<typeof sum>>(null as any).toEqualTypeOf<number>()
  assert.equal(sum.kind, "binary")
  assert.equal(sum.op, "+")
  assert.equal(asNode(sum.left).kind, "literal")
  assert.equal(sum.right, something)

  assert.equal(Expr.sub(1, 2).op, "-")
  assert.equal(Expr.mul(1, 2).op, "*")
  assert.equal(Expr.div(1, 2).op, "/")
  assert.equal(Expr.mod(5, 2).op, "%")
  assert.equal(Expr.eq(1, 2).op, "===")
  assert.equal(Expr.neq(1, 2).op, "!==")
  assert.equal(Expr.lt(1, 2).op, "<")
  assert.equal(Expr.lte(1, 2).op, "<=")
  assert.equal(Expr.gt(1, 2).op, ">")
  assert.equal(Expr.gte(1, 2).op, ">=")
  assert.equal(Expr.and(true, false).op, "&&")
  assert.equal(Expr.or(true, false).op, "||")
})

test("operator result types flow from BinaryResult", () => {
  const str = Expr.add("a", 1)
  expectTypeOf<Expr.Denotes<typeof str>>(null as any).toEqualTypeOf<string>()
  const cmp = Expr.lt(1, 2)
  expectTypeOf<Expr.Denotes<typeof cmp>>(null as any).toEqualTypeOf<boolean>()
  const truthy = Expr.and(Expr.boolean(true), 1)
  expectTypeOf<Expr.Denotes<typeof truthy>>(null as any).toEqualTypeOf<1>()
})

test("not and typeof_ build Unary nodes", () => {
  const negated = Expr.not(Expr.boolean(true))
  expectTypeOf<Expr.Denotes<typeof negated>>(null as any).toEqualTypeOf<boolean>()
  assert.equal(negated.kind, "unary")
  assert.equal(negated.op, "!")
  assert.equal(asNode(negated.operand).kind, "literal")

  const t = Expr.typeof_(2)
  expectTypeOf<Expr.Denotes<typeof t>>(null as any).toEqualTypeOf<
    "string" | "number" | "bigint" | "boolean" | "symbol" | "undefined" | "object" | "function"
  >()
  assert.equal(t.op, "typeof")
})

test("a declared function is called with lifted arguments", () => {
  const program = Program.build(function*() {
    const Classify = yield* fn("classify", {
      params: [Expr.param("score", Type.number)],
      returns: Type.number,
      body: function*({ score }) {
        return score
      },
    })

    const label = yield* Decl.const_("label", Expr.call(Classify, 93))
    expectTypeOf<Expr.Denotes<typeof label>>(null as any).toEqualTypeOf<number>()
    return label
  })
  assert.equal(program.statements.length, 2)
  const built = asNode((program.statements[1] as Decl.BindingDeclaration).expr)
  assert.equal(built.kind, "call")
  const callee = asNode(built.callee)
  assert.equal(callee.kind, "ref")
  assert.equal(callee.nameHint, "classify")
  assert.equal(asNode(built.args[0]).value, 93)
})

test("declared refs still work as plain nodes: explicit Call, Denotes, and lift passthrough", () => {
  Program.build(function*() {
    const Identity = yield* fn("identity", {
      params: [Expr.param("value", Type.number)],
      returns: Type.number,
      body: function*({ value }) {
        return value
      },
    })
    expectTypeOf<ReturnType<Expr.Denotes<typeof Identity>>>(null as any).toEqualTypeOf<number>()
    assert.equal(Expr.lift(Identity), Identity)
    const explicit = Expr.call(Identity, Expr.number(1))
    expectTypeOf<Expr.Denotes<typeof explicit>>(null as any).toEqualTypeOf<number>()
    assert.equal(explicit.kind, "call")
    assert.equal(asNode(explicit.args[0]).kind, "literal")
    assert.equal(asNode(explicit.args[0]).value, 1)
    return explicit
  })
})

test("declared ref calls reject args of the wrong type", () => {
  Program.build(function*() {
    const Classify = yield* fn("classify", {
      params: [Expr.param("score", Type.number)],
      returns: Type.number,
      body: function*({ score }) {
        return score
      },
    })
    Expr.call(Classify, 93)
    // @ts-expect-error - a string does not lift to Expr<number>
    Expr.call(Classify, "no")
    // @ts-expect-error - missing the score argument
    Expr.call(Classify)
    return Expr.call(Classify, 0)
  })
})

test("a generic function ref has to be instantiated before it is called", () => {
  const T = Type.param("T")
  Program.build(function*() {
    const Identity = yield* fn("identity", {
      typeParams: [T],
      params: [Expr.param("value", T)],
      returns: T,
      body: function*({ value }) {
        return value
      },
    })
    // @ts-expect-error - generics stay explicit: Instantiate first
    Expr.call(Identity, 1)
    const instantiated = Expr.instantiate(Identity, Type.number)
    assert.equal(instantiated.kind, "instantiation")
    return instantiated
  })
})

test("Decl.let_ and Decl.const_ define bindings with lifting", () => {
  const program = Program.build(function*() {
    const x = yield* Decl.let_("x", 1)
    expectTypeOf<Expr.Denotes<typeof x>>(null as any).toEqualTypeOf<number>()
    yield* Stmt.assign(x, Expr.number(2))
    const y = yield* Decl.const_("y", 42)
    expectTypeOf<Expr.Denotes<typeof y>>(null as any).toEqualTypeOf<42>()
    return y
  })
  assert.equal(program.statements.length, 3)
  assert.equal(program.statements[0]!.kind, "let-declaration")
  assert.equal(asNode((program.statements[0] as Decl.BindingDeclaration).expr).value, 1)
  assert.equal(program.statements[1]!.kind, "assign")
  assert.equal(program.statements[2]!.kind, "const-declaration")
  assert.equal(asNode((program.statements[2] as Decl.BindingDeclaration).expr).value, 42)
})

test("Stmt.assign lifts values and rejects readonly targets", () => {
  Program.build(function*() {
    const grade = yield* Decl.let_("grade", "F")
    yield* Stmt.assign(grade, "A+")
    const obj = yield* Decl.let_("obj", { count: 0 })
    yield* Stmt.assign(Expr.prop(obj, "count"), 1)
    return grade
  })

  Program.build(function*() {
    const obj = yield* Decl.let_("obj", Type.object({ id: Type.readonly_(Type.number), count: Type.number }))
    Stmt.assign(Expr.prop(obj, "count"), 1)
    // @ts-expect-error - id is readonly
    Stmt.assign(Expr.prop(obj, "id"), 2)
    const tuple = yield* Decl.let_("tuple", Type.tuple(Type.number, Type.string))
    Stmt.assign(Expr.index(tuple, Expr.number(0)), 1)
    Stmt.assign(Expr.index(tuple, Expr.number(1)), "one")
    // @ts-expect-error - tuple index 0 accepts only numbers
    Stmt.assign(Expr.index(tuple, Expr.number(0)), "zero")
    // @ts-expect-error - tuple index 1 accepts only strings
    Stmt.assign(Expr.index(tuple, Expr.number(1)), 1)
    // @ts-expect-error - an out-of-range tuple write is rejected at index construction
    Stmt.assign(Expr.index(tuple, Expr.number(2)), 1)
    const readonlyArray = FFI.Value<readonly number[]>("readonlyArray")
    // @ts-expect-error - readonly array indexes are readonly
    Stmt.assign(Expr.index(readonlyArray, Expr.number(0)), 1)
    return obj
  })
})

test("Stmt.forOf iterates arrays and strings", () => {
  const program = Program.build(function*() {
    yield* Stmt.forOf("item", [1, 2], function*(n) {
      expectTypeOf<Expr.Denotes<typeof n>>(null as any).toEqualTypeOf<number>()
    })
    // a lifted array is an `Expr.array`, which widens its elements whatever the plain array was
    yield* Stmt.forOf("literal", [1, 2] as const, function*(n) {
      expectTypeOf<Expr.Denotes<typeof n>>(null as any).toEqualTypeOf<number>()
      assert.equal((n.type as Type.Primitive).name, "number")
    })
    yield* Stmt.forOf("char", "abc", function*(char) {
      expectTypeOf<Expr.Denotes<typeof char>>(null as any).toEqualTypeOf<string>()
    })
    // @ts-expect-error - cannot iterate a number
    Stmt.forOf("n", 1, function*() {})
    return Expr.number(0)
  })
  assert.deepEqual(program.statements.map((statement) => (statement as Stmt.ForOfStatement).nameHint), ["item", "literal", "char"])
})

test("lifted arrays widen their elements, so bindings and loops agree with Expr.array", () => {
  Program.build(function*() {
    const values = yield* Decl.const_("values", [1, 2])
    expectTypeOf<Expr.Denotes<typeof values>>(null as any).toEqualTypeOf<number[]>()
    yield* Stmt.forOf("n", values, function*(n) {
      expectTypeOf<Expr.Denotes<typeof n>>(null as any).toEqualTypeOf<number>()
    })
    return Expr.number(0)
  })
})

test("type attachment: calls carry return type, binary nodes carry result type", () => {
  const sum = Expr.add(1, 2)
  assert.equal((sum.type as Type.Any)?.kind, "primitive")
  assert.equal((sum.type as any)?.name, "number")

  const check = Expr.gte(1, 2)
  assert.equal((check.type as Type.Any)?.kind, "primitive")
  assert.equal((check.type as any)?.name, "boolean")
})
