import assert from "node:assert/strict"
import { test } from "node:test"

import * as $ from "../src/index.ts"
import { freshBindingId } from "../src/node.ts"
import { emitProgram } from "../targets/ts.ts"
import { expectTypeOf } from "./typing.ts"

const fn = $.fn

test("impl return type still infers from the final expression", () => {
  $.build(function*() {
    const identity = yield* fn("identity", {
      params: [$.param("value", $.Number)],
      body: function*({ value }) {
        return value
      },
    })
    expectTypeOf<ReturnType<$.Denotes<typeof identity>>>().toEqualTypeOf<number>()
    return identity
  })
})

test("early returns yielded directly join the inferred return type (bare yield form)", () => {
  $.build(function*() {
    const f = yield* fn("f", {
      params: [$.param("x", $.Number)],
      body: function*({ x }) {
        yield $.return($.string("early"))
        return x
      },
    })
    expectTypeOf<ReturnType<$.Denotes<typeof f>>>().toEqualTypeOf<number | "early">()
    return f
  })
})

test("early returns inside an if branch reach the inferred return type", () => {
  $.build(function*() {
    const f = yield* fn("f", {
      params: [$.param("x", $.Number)],
      body: function*({ x }) {
        yield* $.if($.binary("<", x, $.number(0)), function*() {
          yield* $.return($.string("negative"))
        })
        return x
      },
    })
    expectTypeOf<ReturnType<$.Denotes<typeof f>>>().toEqualTypeOf<number | "negative">()
    return f
  })
})

test("early returns propagate through arbitrarily nested control flow", () => {
  $.build(function*() {
    const f = yield* fn("f", {
      params: [$.param("x", $.Number)],
      body: function*({ x }) {
        yield* $.while($.binary(">", x, $.number(0)), function*() {
          yield* $.if($.binary("===", x, $.number(1)), function*() {
            yield* $.return($.string("deep"))
          })
          yield* $.assign(x, $.binary("-", x, $.number(1)))
        })
        return x
      },
    })
    expectTypeOf<ReturnType<$.Denotes<typeof f>>>().toEqualTypeOf<number | "deep">()
    return f
  })
})

test("elseif and else branches contribute early returns too", () => {
  $.build(function*() {
    const f = yield* fn("f", {
      params: [$.param("x", $.Number)],
      body: function*({ x }) {
        yield* $.if($.binary("<", x, $.number(0)), function*() {
          yield* $.return($.string("neg"))
        }).pipe(
          $.elseIf($.binary("===", x, $.number(0)), function*() {
            yield* $.return($.boolean(true))
          }),
          $.else(function*() {
            yield* $.return($.number(-1))
          }),
        )
        return x
      },
    })
    expectTypeOf<ReturnType<$.Denotes<typeof f>>>().toEqualTypeOf<number | "neg" | true>()
    return f
  })
})

test("else closes the if builder against further clauses", () => {
  const builder = $.if($.boolean(true), function*() {}).pipe($.else(function*() {}))
  // @ts-expect-error - cannot add clauses after else
  builder.pipe($.elseIf($.boolean(true), function*() {}))
  // @ts-expect-error - cannot else twice
  builder.pipe($.else(function*() {}))
})

test("bodies never run unless the builder is yielded", () => {
  const ran: string[] = []
  $.build(function*() {
    $.if($.boolean(true), function*() {
      ran.push("if")
    })
    $.while($.boolean(true), function*() {
      ran.push("while")
    })
    $.forOf("item", $.array($.number(1)), function*() {
      ran.push("for-of")
    })
    return $.number(1)
  })
  assert.deepEqual(ran, [])
})

test("a control-flow builder is a description: yielding it twice builds two independent statements", () => {
  const loop = $.forOf("item", $.array($.number(1)), function*(item) {
    yield* $.const("copy", item)
  })
  const program = $.build(function*() {
    yield* loop
    yield* loop
    return null
  })
  const [first, second] = program.statements as $.ForOfStatement[]
  assert.notEqual(first!.id, second!.id)
})

test("if drains its branches into nested blocks", () => {
  const program = $.build(function*() {
    const x = yield* $.let("x", $.number(1))
    yield* $.if($.binary(">", x, $.number(0)), function*() {
      yield* $.assign(x, $.number(2))
    }).pipe(
      $.elseIf($.binary("===", x, $.number(0)), function*() {
        yield* $.assign(x, $.number(1))
      }),
      $.else(function*() {
        yield* $.assign(x, $.number(-1))
      }),
    )
    return x
  })
  const ifStatement = program.statements[1] as $.IfStatement
  assert.equal(ifStatement.kind, "if")
  assert.equal(ifStatement.clauses.length, 2)
  assert.equal(ifStatement.clauses[0]!.body.kind, "block")
  assert.equal(ifStatement.clauses[0]!.body.statements[0]!.kind, "assign")
  assert.equal((ifStatement.clauses[1]!.condition as unknown as { readonly kind: string }).kind, "binary")
  assert.equal(ifStatement.else!.statements[0]!.kind, "assign")
})

test("while drains its body into a nested block", () => {
  const program = $.build(function*() {
    const x = yield* $.let("x", $.number(3))
    yield* $.while($.binary(">", x, $.number(0)), function*() {
      yield* $.assign(x, $.binary("-", x, $.number(1)))
      yield* $.continue()
    })
    return x
  })
  const whileStatement = program.statements[1] as $.WhileStatement
  assert.equal(whileStatement.kind, "while")
  assert.equal((whileStatement.condition as unknown as { readonly kind: string }).kind, "binary")
  assert.deepEqual(
    whileStatement.body.statements.map((statement) => statement.kind),
    ["assign", "continue"],
  )
})

test("let widens literal initializers so reassignment typechecks", () => {
  $.build(function*() {
    const x = yield* $.let("x", $.number(1))
    expectTypeOf<$.Denotes<typeof x>>().toEqualTypeOf<number>()
    $.assign(x, $.number(2))
    // @ts-expect-error - a string is not assignable to a number ref
    $.assign(x, $.string("no"))
    return x
  })
})

test("let widening recurses into object fields", () => {
  $.build(function*() {
    const obj = yield* $.let("obj", $.object({ count: $.number(0) }))
    expectTypeOf<$.Denotes<typeof obj>>().toEqualTypeOf<{ count: number }>()
    $.assign($.prop(obj, "count"), $.number(1))
    // @ts-expect-error - the count field denotes number
    $.assign($.prop(obj, "count"), $.string("no"))
    return obj
  })
})

test("for-of injects a typed loop variable and drains its body", () => {
  const program = $.build(function*() {
    const total = yield* $.let("total", $.number(0))
    yield* $.forOf("item", $.array($.number(1), $.number(2)), function*(item) {
      expectTypeOf<$.Denotes<typeof item>>().toEqualTypeOf<number>()
      yield* $.assign(total, $.binary("+", total, item))
    })
    return total
  })
  const ForOf = program.statements[1] as $.ForOfStatement
  assert.equal(ForOf.kind, "for-of")
  assert.equal(ForOf.nameHint, "item")
  assert.equal(ForOf.body.kind, "block")
  assert.equal(ForOf.body.statements[0]!.kind, "assign")
})

test("for-of over a string iterates characters", () => {
  $.build(function*() {
    yield* $.forOf("char", $.string("abc"), function*(char) {
      expectTypeOf<$.Denotes<typeof char>>().toEqualTypeOf<string>()
    })
    return $.number(0)
  })
})

test("for-of rejects non-iterables", () => {
  // @ts-expect-error - cannot iterate a number
  $.forOf("x", $.number(1), function*(_x) {})
})

test("cond denotes the union of its branches", () => {
  const cond = $.cond($.boolean(true), $.number(1), $.string("s"))
  expectTypeOf<$.Denotes<typeof cond>>().toEqualTypeOf<1 | "s">()
  assert.equal(cond.kind, "cond")
  assert.equal((cond.else as { readonly kind: string }).kind, "literal")
})

test("function impls drain into a body block with a trailing return", () => {
  const program = $.build(function*() {
    const identity = yield* fn("identity", {
      params: [$.param("value", $.Number)],
      body: function*({ value }) {
        const doubled = yield* $.let("doubled", $.binary("*", value, $.number(2)))
        return doubled
      },
    })
    return identity
  })
  const declaration = program.statements[0] as $.BuiltFunction
  assert.equal("impl" in declaration, false)
  assert.equal(declaration.body.kind, "block")
  assert.deepEqual(
    declaration.body.statements.map((statement) => statement.kind),
    ["let-declaration", "return"],
  )
  const returnStatement = declaration.body.statements[1] as $.ReturnStatement
  const returned = returnStatement.value as $.Ref
  assert.equal(returned.kind, "ref")
  assert.equal(returned.nameHint, "doubled")
})

test("return statements cannot escape to the top level", () => {
  const factory = function*() {
    yield $.return($.number(1))
    return $.number(1)
  }
  // @ts-expect-error - return is function-scoped
  $.build(factory)
})

test("break and continue are accepted only in loop bodies", () => {
  const breakProgram = function*() {
    yield $.break()
    return $.number(0)
  }
  // @ts-expect-error - break requires an enclosing loop
  const _badProgram = () => $.build(breakProgram)

  const continueProgram = function*() {
    yield $.continue()
    return $.number(0)
  }
  // @ts-expect-error - continue requires an enclosing loop
  const _badContinueProgram = () => $.build(continueProgram)

  const _badFunction = () =>
    fn("badBreak", {
      // @ts-expect-error - a function body is not a loop body
      body: function*() {
        yield* $.break()
        return $.number(0)
      },
    })

  const _badArrow = () =>
    $.arrow({
      // @ts-expect-error - an arrow body is not a loop body
      body: function*() {
        yield* $.continue()
        return $.number(0)
      },
    })

  const badIf = $.if($.boolean(true), function*() {
    yield* $.break()
  })
  const badIfBody = function*() {
    yield* badIf
    return $.number(0)
  }
  // @ts-expect-error - an if alone does not provide a loop target
  const _badNestedBreak = () => $.arrow({ body: badIfBody })
})

test("runtime validation rejects control-flow nodes that bypass the public types", () => {
  assert.throws(
    () =>
      $.build(function*() {
        yield $.break() as unknown as $.ThrowStatement
        return $.number(0)
      }),
    /break requires an enclosing loop/,
  )
  assert.throws(
    () =>
      $.build(function*() {
        yield* fn("bad", {
          body: function*() {
            yield $.continue() as unknown as $.ThrowStatement
            return $.number(0)
          },
        })
        return $.number(0)
      }),
    /continue requires an enclosing loop/,
  )
})

test("runtime validation resets loop context at arrow boundaries", () => {
  const badArrow = $.arrow({
    body: function*() {
      yield $.break() as unknown as $.ThrowStatement
      return $.number(0)
    },
  })
  assert.throws(
    () =>
      $.build(function*() {
        yield* $.const("badArrow", badArrow)
        return $.number(0)
      }),
    /break requires an enclosing loop/,
  )

  assert.throws(
    () =>
      $.build(function*() {
        yield* $.while($.boolean(true), function*() {
          yield* $.do($.call(
            $.hostValue<(callback: () => number) => void>("use"),
            $.arrow({
              body: function*() {
                yield $.continue() as unknown as $.ThrowStatement
                return $.number(0)
              },
            }),
          ))
        })
        return $.number(0)
      }),
    /continue requires an enclosing loop/,
  )
})

test("break and continue pass through control flow nested in loops", () => {
  const program = $.build(function*() {
    yield* $.while($.boolean(true), function*() {
      yield* $.if($.boolean(true), function*() {
        yield* $.continue()
      }).pipe(
        $.else(function*() {
          yield* $.break()
        }),
      )
    })
    yield* $.forOf("item", $.array($.number(1)), function*(_item) {
      yield* $.if($.boolean(true), function*() {
        yield* $.break()
      })
      yield* $.continue()
    })
    return $.number(0)
  })

  const whileStatement = program.statements[0] as $.WhileStatement
  const nestedIf = whileStatement.body.statements[0] as $.IfStatement
  assert.equal(nestedIf.clauses[0]!.body.statements[0]!.kind, "continue")
  assert.equal(nestedIf.else!.statements[0]!.kind, "break")
  const forOf = program.statements[1] as $.ForOfStatement
  assert.deepEqual(forOf.body.statements.map((statement) => statement.kind), ["if", "continue"])
})

test("redeclaring an identity in the same scope throws", () => {
  const binding = $.let("x", $.number(1))
  assert.throws(
    () =>
      $.build(function*() {
        yield* binding
        yield* binding
        return $.number(0)
      }),
    /declared more than once with the same identity/,
  )
})

test("shadowed bindings keep distinct identities and emitted names", () => {
  let outerTarget = freshBindingId()
  let innerTarget = freshBindingId()
  const program = $.build(function*() {
    const read = yield* fn("read", {
      body: function*() {
        const outer = yield* $.let("value", $.number(1))
        outerTarget = outer.id!
        yield* $.if($.boolean(true), function*() {
          const inner = yield* $.let("value", $.number(2))
          innerTarget = inner.id!
          yield* $.do($.call($.hostValue<(value: number) => void>("use"), outer))
        })
        return outer
      },
    })
    return read
  })

  assert.notEqual(outerTarget, innerTarget)
  assert.match(emitProgram(program), /let value = 1;/)
  assert.match(emitProgram(program), /let value_2 = 2;/)
  assert.match(emitProgram(program), /use\(value\);/)
})

test("a local reference must target an in-scope declaration", () => {
  assert.throws(
    () =>
      $.build(function*() {
        yield* $.do($.ref(freshBindingId(), "missing", undefined, true, false))
        return $.number(0)
      }),
    /does not resolve to an in-scope binding/,
  )
})

test("params and sibling scopes may reuse names", () => {
  const program = $.build(function*() {
    yield* fn("f", {
      params: [$.param("value", $.Number)],
      body: function*({ value }) {
        return value
      },
    })
    yield* $.let("value", $.number(1))
    yield* $.if($.boolean(true), function*() {
      yield* $.let("tmp", $.number(1))
    }).pipe(
      $.else(function*() {
        yield* $.let("tmp", $.number(2))
      }),
    )
    return $.number(0)
  })
  assert.equal(program.statements.length, 3)
})

test("throw drains as a plain statement", () => {
  const program = $.build(function*() {
    yield* $.throw($.string("boom"))
    return $.number(0)
  })
  const throwStatement = program.statements[0] as $.ThrowStatement
  assert.equal(throwStatement.kind, "throw")
  assert.equal((throwStatement.value as unknown as { readonly kind: string }).kind, "literal")
})

test("const keeps top-level literal types", () => {
  const program = $.build(function*() {
    const x = yield* $.const("x", $.number(42))
    expectTypeOf<$.Denotes<typeof x>>().toEqualTypeOf<42>()
    return x
  })
  assert.equal(program.statements[0]!.kind, "const-declaration")
})

test("const widens object fields but the binding is not assignable", () => {
  $.build(function*() {
    const obj = yield* $.const("obj", $.object({ count: $.number(0) }))
    expectTypeOf<$.Denotes<typeof obj>>().toEqualTypeOf<{ count: number }>()
    $.assign($.prop(obj, "count"), $.number(1))
    // @ts-expect-error - cannot reassign a const binding
    $.assign(obj, $.object({ count: $.number(1) }))
    return obj
  })
})

test("a declaration cannot be yielded until it is finished", () => {
  const unfinished = function*() {
    // @ts-expect-error - a const needs an initializer
    yield* $.const("x")
    // @ts-expect-error - so does a let, unless it is declared with a type
    yield* $.let("y")
    // @ts-expect-error - a function needs a body
    yield* fn("f")
    yield* $.let("z", $.Number)
  }
  void unfinished
})

test("a finished declaration takes no further steps", () => {
  const unused = () => {
    // @ts-expect-error - a const needs an initializer
    $.const("x")
    // @ts-expect-error - a string is not a number
    $.let("n", $.string("no"), $.Number)
  }
  void unused
})

test("an initializer has to be assignable to the annotation", () => {
  $.const("point", $.object({ id: $.number(1), count: $.number(2) }), $.Object({ id: $.Number, count: $.Number }))
  // @ts-expect-error - the annotation promises a count the value does not have
  $.const("point", $.object({ id: $.number(1) }), $.Object({ id: $.Number, count: $.Number }))
  // @ts-expect-error - a string is not a number
  $.let("n", $.string("no"), $.Number)

  $.build(function*() {
    const ok = yield* $.let("ok", $.boolean(true), $.Literal(true))
    expectTypeOf<$.Denotes<typeof ok>>().toEqualTypeOf<true>()
    return null
  })
})

test("a step held in a variable is checked like one written inline", () => {
  const invalid = fn("f", {
    returns: $.String,
    body: function*() {
      yield* $.return($.number(1))
      return $.string("ok")
    },
  })
  const rejected = function*() {
    // @ts-expect-error - the number early return does not satisfy the declared string
    yield* invalid
  }
  void rejected
  // @ts-expect-error - a string is not a number
  $.let("n", $.string("no"), $.Number)
})

test("a parameter list is one TypeScript accepts", () => {
  fn("ok", {
    params: [$.param("a", $.Number), $.optional("b", $.Number), $.rest("rest", $.Number)],
    body: function*() {
      return $.number(0)
    },
  })
  // @ts-expect-error - a rest parameter must be last
  fn("badRest", {
    params: [$.rest("rest", $.Number), $.param("a", $.Number)],
    body: function*() {
      return $.number(0)
    },
  })
  // @ts-expect-error - a required parameter cannot follow an optional one
  fn("badRequired", {
    params: [$.optional("b", $.Number), $.param("a", $.Number)],
    body: function*() {
      return $.number(0)
    },
  })
})

test("const participates in scope validation", () => {
  const binding = $.const("x", $.number(1))
  assert.throws(
    () =>
      $.build(function*() {
        yield* binding
        yield* binding
        return $.number(0)
      }),
    /declared more than once with the same identity/,
  )
})

test("for-of loop variables are not assignable", () => {
  const program = $.build(function*() {
    yield* $.forOf("item", $.array($.number(1)), function*(item) {
      // @ts-expect-error - the loop variable is a fresh const per iteration
      yield* $.assign(item, $.number(2))
    })
    return $.number(0)
  })
  const loop = program.statements[0] as $.ForOfStatement
  assert.equal(
    emitProgram(program),
    `for (const item of [1]) {
  item = 2;
}`,
  )
  assert.equal(loop.kind, "for-of")
})

test("params remain assignable", () => {
  const program = $.build(function*() {
    yield* fn("f", {
      params: [$.param("x", $.Number)],
      body: function*({ x }) {
        yield* $.assign(x, $.number(1))
        return x
      },
    })
    return $.number(0)
  })
  assert.equal(
    emitProgram(program),
    `function f(x: number) {
  x = 1;
  return x;
}`,
  )
})

test("yield* on plain statement data drains it", () => {
  const program = $.build(function*() {
    const x = yield* $.let("x", $.number(0))
    yield* $.assign(x, $.number(1))
    yield* $.do($.number(1))
    return x
  })
  assert.equal(program.statements[1]!.kind, "assign")
  assert.equal(program.statements[2]!.kind, "expr-statement")
})

test("bare yield of plain statement data still drains the same", () => {
  const program = $.build(function*() {
    const x = yield* $.let("x", $.number(0))
    yield $.assign(x, $.number(1))
    return x
  })
  assert.equal(program.statements[1]!.kind, "assign")
})

test("meaningless expression yields are rejected", () => {
  const bareLiteral = function*() {
    yield $.number(1)
  }
  // @ts-expect-error - a literal is not a statement
  $.if($.boolean(true), bareLiteral)

  const badProgram = function*() {
    yield $.number(1)
    return $.number(0)
  }
  // @ts-expect-error - a literal is not a top-level statement
  const _rejected = () => $.build(badProgram)
})

test("a body is emitted as written, including what follows a return", () => {
  const program = $.build(function*() {
    yield* fn("f", {
      body: function*() {
        yield* $.return($.number(1))
        yield* $.do($.number(2))
        return $.number(3)
      },
    })
    return $.number(0)
  })
  const declaration = program.statements[0] as $.BuiltFunction
  assert.deepEqual(
    declaration.body.statements.map((statement) => statement.kind),
    ["return", "expr-statement", "return"],
  )
  const returned = (declaration.type as $.Function).return as $.Union
  assert.deepEqual(returned.members.map((member) => (member as $.Literal).value), [1, 3])
})

test("declared return types check early returns", () => {
  const program = $.build(function*() {
    yield* fn("f", {
      params: [$.param("x", $.Number)],
      returns: $.String,
      body: function*({ x }) {
        yield* $.if($.binary(">", x, $.number(0)), function*() {
          yield* $.return($.string("pos"))
        })
        return $.string("done")
      },
    })
    return $.number(0)
  })
  assert.equal(
    emitProgram(program),
    `function f(x: number): string {
  if (x > 0) {
    return "pos";
  }
  return "done";
}`,
  )
})

test("declared return types reject mismatched early returns", () => {
  const invalid = fn("f", {
    params: [$.param("x", $.Number)],
    returns: $.String,
    body: function*({ x: _x }) {
      yield* $.return($.number(1))
      return $.string("ok")
    },
  })
  const rejected = function*() {
    // @ts-expect-error - the number early return does not satisfy the declared string
    yield* invalid
  }
  void rejected
})

test("declared return types reject mismatched final expressions", () => {
  const invalid = fn("f", {
    returns: $.String,
    body: function*() {
      return $.number(1)
    },
  })
  const rejected = function*() {
    // @ts-expect-error - the final expression does not satisfy the declared return
    yield* invalid
  }
  void rejected
})

test("assignment uses declared write types and rejects readonly targets", () => {
  $.build(function*() {
    const obj = yield* $.let(
      "obj",
      $.Object({
        id: $.Readonly($.Number),
        count: $.Number,
        name: $.Optional($.String),
        explicit: $.Optional($.Union($.String, $.Undefined)),
        required: $.String,
      }),
    )
    $.assign($.prop(obj, "count"), $.number(1))
    $.assign($.prop(obj, "required"), $.string("ok"))
    $.assign($.prop(obj, "name"), $.string("ok"))
    // @ts-expect-error - exact optional property writes do not accept implicit undefined
    $.assign($.prop(obj, "name"), $.hostValue<undefined>("undefinedValue"))
    $.assign($.prop(obj, "explicit"), $.hostValue<undefined>("undefinedValue"))
    // @ts-expect-error - id is readonly
    $.assign($.prop(obj, "id"), $.number(2))

    const mutableArray = yield* $.let("mutableArray", $.Array($.Number))
    $.assign($.index(mutableArray, $.number(0)), $.number(1))
    const mutableTuple = yield* $.let("mutableTuple", $.Tuple($.Number, $.String))
    $.assign($.index(mutableTuple, $.number(0)), $.number(1))
    $.assign($.index(mutableTuple, $.number(1)), $.string("one"))
    // @ts-expect-error - tuple index 2 is out of range
    $.index(mutableTuple, $.number(2))
    // @ts-expect-error - negative tuple indexes are invalid
    $.index(mutableTuple, $.number(-1))
    // @ts-expect-error - fractional tuple indexes are invalid
    $.index(mutableTuple, $.number(0.5))
    // @ts-expect-error - an out-of-range tuple write is rejected at index construction
    $.assign($.index(mutableTuple, $.number(2)), $.number(1))
    const broadIndex = $.hostValue<number>("broadIndex")
    $.assign($.index(mutableTuple, broadIndex), $.number(1))
    $.index(mutableArray, $.number(100))
    // @ts-expect-error - tuple index 0 accepts only numbers
    $.assign($.index(mutableTuple, $.number(0)), $.string("zero"))
    // @ts-expect-error - tuple index 1 accepts only strings
    $.assign($.index(mutableTuple, $.number(1)), $.number(1))

    const readonlyArray = $.hostValue<readonly number[]>("readonlyArray")
    // @ts-expect-error - readonly arrays cannot be written through an index
    $.assign($.index(readonlyArray, $.number(0)), $.number(1))
    const readonlyTuple = $.hostValue<readonly [number, string]>("readonlyTuple")
    // @ts-expect-error - readonly tuples cannot be written through an index
    $.assign($.index(readonlyTuple, $.number(0)), $.number(1))
    return obj
  })
})

test("conditions must be boolean", () => {
  const cond = $.number(1)
  // @ts-expect-error - numbers are not valid conditions
  $.if(cond, function*() {})
  // @ts-expect-error - numbers are not valid conditions
  $.while(cond, function*() {})
  // @ts-expect-error - numbers are not valid conditions
  $.cond(cond, $.number(1), $.number(2))
})
