import { Decl, Expr, FFI, Guard, Program, Stmt, Type } from "../../src/index.ts"
import { emitProgram } from "../../targets/js.ts"
import { type Issue, runtime, type SafeParse, ValidationError } from "./runtime.ts"
import { type Infer, objectFields, type Schema } from "./schema.ts"

export { ValidationError } from "./runtime.ts"
export type { Issue, SafeParse } from "./runtime.ts"

export interface Compiled<T> {
  parse(input: unknown): T
  safeParse(input: unknown): SafeParse<T>
  toCode(): string
}

const helpers = FFI.Value<typeof runtime>("runtime")
const undefinedValue = FFI.Value<undefined>("undefined")
const number = FFI.Value<typeof Number>("Number")
const array = FFI.Value<typeof Array>("Array")
const issueType = Type.object({ path: Type.array(Type.union(Type.string, Type.number)), expected: Type.string })
type Path = readonly Expr.In<string | number>[]

function* lower(
  node: Schema,
  input: Expr.Expr<unknown>,
  path: Path,
  issues: Expr.Expr<Issue[]>,
): Generator<Stmt.NonLoopStatement, Expr.Expr<unknown>, unknown> {
  const output = yield* Decl.let_("value", undefinedValue, Type.unknown)

  function* fail(expected: string) {
    yield* Stmt.do_(Expr.call(Expr.prop(issues, "push"), Expr.object({ path: Expr.array(...path), expected })))
  }

  function* scalar(valid: Expr.Expr<boolean>, expected: string, value: Expr.Expr<unknown> = input) {
    yield* Stmt.else_(function*() {
      yield* fail(expected)
    })(Stmt.if_(valid, function*() {
      yield* Stmt.assign(output, value)
    }))
  }

  function* guardedScalar<T>(guard: Guard.Guard<T>, constraint: (value: Expr.Expr<T>) => Expr.Expr<boolean>, expected: string, nameHint: string) {
    const ok = yield* Decl.let_("ok", false)
    yield* Stmt.ifGuard(guard, function*(value) {
      yield* Stmt.assign(ok, constraint(value))
    }, nameHint)
    yield* scalar(ok, expected)
  }

  switch (node.kind) {
    case "string": {
      const expected = `string with at least ${node.minLength} characters`
      yield* guardedScalar(Guard.typeof_(input, "string"), (text) => Expr.gte(Expr.prop(text, "length"), node.minLength), expected, "text")
      break
    }
    case "number": {
      const expected = `finite ${node.integer ? "integer" : "number"}${node.min === undefined ? "" : ` >= ${node.min}`}`
      yield* guardedScalar(
        Guard.typeof_(input, "number"),
        (numeric) => {
          let valid: Expr.Expr<boolean> = Expr.call(Expr.prop(number, "isFinite"), numeric)
          if (node.min !== undefined) valid = Expr.and(valid, Expr.gte(numeric, node.min))
          if (node.integer) valid = Expr.and(valid, Expr.call(Expr.prop(number, "isInteger"), numeric))
          return valid
        },
        expected,
        "numeric",
      )
      break
    }
    case "boolean":
      yield* Stmt.ifGuard(Guard.typeof_(input, "boolean"), function*(boolean) {
        yield* Stmt.assign(output, boolean)
      }, "boolean").pipe(Stmt.else_(function*() {
        yield* fail("boolean")
      }))
      break
    case "literal":
      yield* scalar(Expr.eq(input, node.value === null ? Expr.null_() : Expr.lift(node.value)), JSON.stringify(node.value))
      break
    case "optional":
      yield* Stmt.if_(Expr.neq(input, undefinedValue), function*() {
        const value = yield* lower(node.item, input, path, issues)
        yield* Stmt.assign(output, value)
      })
      break
    case "array":
      yield* Stmt.else_(function*() {
        yield* fail("array")
      })(Stmt.ifGuard(Guard.isArray(input), function*(items) {
        const values = yield* Decl.const_("values", Expr.array(), Type.array(Type.unknown))
        const index = yield* Decl.let_("index", 0)
        yield* Stmt.while_(Expr.lt(index, Expr.prop(items, "length")), function*() {
          const item = yield* Decl.const_("item", Expr.index(items, index))
          const value = yield* lower(node.item, item, [...path, index], issues)
          yield* Stmt.do_(Expr.call(Expr.prop(values, "push"), value))
          yield* Stmt.assign(index, Expr.add(index, 1))
        })
        yield* Stmt.assign(output, values)
      }, "items"))
      break
    case "object": {
      const ok = yield* Decl.let_("ok", false)
      yield* Stmt.ifGuard(Guard.and(Guard.typeof_(input, "object"), Guard.notNullish(input)), function*(record) {
        yield* Stmt.if_(Expr.not(Expr.call(Expr.prop(array, "isArray"), record)), function*() {
          const object = yield* Decl.const_("object", Expr.object({}))
          for (const [key, child] of objectFields(node.fields)) {
            function* field() {
              const inputField = yield* Decl.const_("field", Expr.call(Expr.prop(helpers, "ownRead"), record, key), Type.unknown)
              const value = yield* lower(child, inputField, [...path, key], issues)
              yield* Stmt.do_(Expr.call(Expr.prop(helpers, "defineOwn"), object, key, value))
            }
            if (child.kind === "optional") {
              yield* Stmt.if_(Guard.hasOwn(record, key).condition, field)
            } else {
              yield* field()
            }
          }
          yield* Stmt.assign(output, object)
          yield* Stmt.assign(ok, true)
        })
      }, "record")
      yield* Stmt.if_(Expr.not(ok), function*() {
        yield* fail("object")
      })
      break
    }
    default: {
      const exhaustive: never = node
      return exhaustive
    }
  }
  return output
}

export function compile<const S extends Schema>(schema: S): Compiled<Infer<S>>
export function compile(schema: Schema): Compiled<unknown> {
  const program = Program.build(function*() {
    yield* Decl.fn("validate", {
      params: [Expr.param("input", Type.unknown)],
      body: function*({ input }) {
        const issues = yield* Decl.const_("issues", Expr.array(), Type.array(issueType))
        const data = yield* lower(schema, input, [], issues)
        return Expr.cond(Expr.eq(Expr.prop(issues, "length"), 0), Expr.object({ success: true, data }), Expr.object({ success: false, issues }))
      },
    })
    return null
  })
  const source = `${emitProgram(program)}\nreturn validate;`
  // SAFETY: generated checks establish Infer<S> on success; the evaluator is the single untyped JavaScript boundary.
  const validate = new Function("runtime", source)(runtime) as (input: unknown) => SafeParse<unknown>
  return {
    safeParse: validate,
    parse(input) {
      const result = validate(input)
      if (!result.success) throw new ValidationError(result.issues)
      return result.data
    },
    toCode: () => source,
  }
}
