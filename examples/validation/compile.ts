import { Decl, Expr, FFI, Program, Stmt, Type } from "../../src/index.ts"
import { emitProgram } from "../../targets/javascript/index.ts"
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
const nullValue = Expr.prop(helpers, "nullValue")
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

  function* scalar(valid: Expr.Expr<boolean>, expected: string) {
    yield* Stmt.else_(function*() {
      yield* fail(expected)
    })(Stmt.if_(valid, function*() {
      yield* Stmt.assign(output, input)
    }))
  }

  switch (node.kind) {
    case "string":
      yield* scalar(Expr.call(Expr.prop(helpers, "stringAtLeast"), input, node.minLength), `string with at least ${node.minLength} characters`)
      break
    case "number":
      yield* scalar(
        Expr.call(Expr.prop(helpers, "numberMatches"), input, node.min === undefined ? undefinedValue : Expr.number(node.min), node.integer),
        `finite ${node.integer ? "integer" : "number"}${node.min === undefined ? "" : ` >= ${node.min}`}`,
      )
      break
    case "boolean":
      yield* scalar(Expr.eq(Expr.typeof_(input), "boolean"), "boolean")
      break
    case "literal":
      yield* scalar(Expr.eq(input, node.value === null ? nullValue : Expr.lift(node.value)), JSON.stringify(node.value))
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
      })(Stmt.if_(Expr.call(Expr.prop(helpers, "isArray"), input), function*() {
        const items = yield* Decl.const_("items", Expr.call(Expr.prop(helpers, "arrayItems"), input))
        const values = yield* Decl.const_("values", Expr.array(), Type.array(Type.unknown))
        const index = yield* Decl.let_("index", 0)
        yield* Stmt.while_(Expr.lt(index, Expr.prop(items, "length")), function*() {
          const item = yield* Decl.const_("item", Expr.index(items, index))
          const value = yield* lower(node.item, item, [...path, index], issues)
          yield* Stmt.do_(Expr.call(Expr.prop(values, "push"), value))
          yield* Stmt.assign(index, Expr.add(index, 1))
        })
        yield* Stmt.assign(output, values)
      }))
      break
    case "object":
      yield* Stmt.else_(function*() {
        yield* fail("object")
      })(Stmt.if_(Expr.call(Expr.prop(helpers, "isObject"), input), function*() {
        const object = yield* Decl.const_("object", Expr.object({}))
        for (const [key, child] of objectFields(node.fields)) {
          function* field() {
            const inputField = yield* Decl.const_("field", Expr.call(Expr.prop(helpers, "ownRead"), input, key))
            const value = yield* lower(child, inputField, [...path, key], issues)
            yield* Stmt.do_(Expr.call(Expr.prop(helpers, "defineOwn"), object, key, value))
          }
          if (child.kind === "optional") {
            yield* Stmt.if_(Expr.call(Expr.prop(helpers, "hasOwn"), input, key), field)
          } else {
            yield* field()
          }
        }
        yield* Stmt.assign(output, object)
      }))
      break
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
