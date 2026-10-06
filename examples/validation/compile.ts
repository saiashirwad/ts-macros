import * as T from "../../src/index.ts"
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

const helpers = T.hostValue<typeof runtime>("runtime")
const undefinedValue = T.hostValue<undefined>("undefined")
const number = T.hostValue<typeof Number>("Number")
const array = T.hostValue<typeof Array>("Array")
const issueType = T.Object({ path: T.Array(T.Union(T.String, T.Number)), expected: T.String })
type Path = readonly T.In<string | number>[]

function* lower(
  node: Schema,
  input: T.Expr<unknown>,
  path: Path,
  issues: T.Expr<Issue[]>,
): Generator<T.NonLoopStatement, T.Expr<unknown>, unknown> {
  const output = yield* T.let("value", undefinedValue, T.Unknown)

  function* fail(expected: string) {
    yield* T.do(T.call(T.prop(issues, "push"), T.objectLiteral({ path: T.arrayLiteral(...path), expected })))
  }

  function* scalar(valid: T.Expr<boolean>, expected: string, value: T.Expr<unknown> = input) {
    yield* T.else(function*() {
      yield* fail(expected)
    })(T.if(valid, function*() {
      yield* T.assign(output, value)
    }))
  }

  function* guardedScalar<T>(guard: T.Guard<T>, constraint: (value: T.Expr<T>) => T.Expr<boolean>, expected: string, nameHint: string) {
    const ok = yield* T.let("ok", false)
    yield* T.ifGuard(guard, function*(value) {
      yield* T.assign(ok, constraint(value))
    }, nameHint)
    yield* scalar(ok, expected)
  }

  switch (node.kind) {
    case "string": {
      const expected = `string with at least ${node.minLength} characters`
      yield* guardedScalar(T.isTypeof(input, "string"), (text) => T.gte(T.prop(text, "length"), node.minLength), expected, "text")
      break
    }
    case "number": {
      const expected = `finite ${node.integer ? "integer" : "number"}${node.min === undefined ? "" : ` >= ${node.min}`}`
      yield* guardedScalar(
        T.isTypeof(input, "number"),
        (numeric) => {
          let valid: T.Expr<boolean> = T.call(T.prop(number, "isFinite"), numeric)
          if (node.min !== undefined) valid = T.and(valid, T.gte(numeric, node.min))
          if (node.integer) valid = T.and(valid, T.call(T.prop(number, "isInteger"), numeric))
          return valid
        },
        expected,
        "numeric",
      )
      break
    }
    case "boolean":
      yield* T.ifGuard(T.isTypeof(input, "boolean"), function*(boolean) {
        yield* T.assign(output, boolean)
      }, "boolean").pipe(T.else(function*() {
        yield* fail("boolean")
      }))
      break
    case "literal":
      yield* scalar(T.eq(input, node.value === null ? T.nullLiteral() : T.lift(node.value)), JSON.stringify(node.value))
      break
    case "optional":
      yield* T.if(T.neq(input, undefinedValue), function*() {
        const value = yield* lower(node.item, input, path, issues)
        yield* T.assign(output, value)
      })
      break
    case "array":
      yield* T.else(function*() {
        yield* fail("array")
      })(T.ifGuard(T.isArray(input), function*(items) {
        const values = yield* T.const("values", T.arrayLiteral(), T.Array(T.Unknown))
        const index = yield* T.let("index", 0)
        yield* T.while(T.lt(index, T.prop(items, "length")), function*() {
          const item = yield* T.const("item", T.index(items, index))
          const value = yield* lower(node.item, item, [...path, index], issues)
          yield* T.do(T.call(T.prop(values, "push"), value))
          yield* T.assign(index, T.add(index, 1))
        })
        yield* T.assign(output, values)
      }, "items"))
      break
    case "object": {
      const ok = yield* T.let("ok", false)
      yield* T.ifGuard(T.allOf(T.isTypeof(input, "object"), T.notNullish(input)), function*(record) {
        yield* T.if(T.not(T.call(T.prop(array, "isArray"), record)), function*() {
          const object = yield* T.const("object", T.objectLiteral({}))
          for (const [key, child] of objectFields(node.fields)) {
            function* field() {
              const inputField = yield* T.const("field", T.call(T.prop(helpers, "ownRead"), record, key), T.Unknown)
              const value = yield* lower(child, inputField, [...path, key], issues)
              yield* T.do(T.call(T.prop(helpers, "defineOwn"), object, key, value))
            }
            if (child.kind === "optional") {
              yield* T.if(T.hasOwn(record, key).condition, field)
            } else {
              yield* field()
            }
          }
          yield* T.assign(output, object)
          yield* T.assign(ok, true)
        })
      }, "record")
      yield* T.if(T.not(ok), function*() {
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
  const program = T.build(function*() {
    yield* T.fn("validate", {
      params: [T.param("input", T.Unknown)],
      body: function*({ input }) {
        const issues = yield* T.const("issues", T.arrayLiteral(), T.Array(issueType))
        const data = yield* lower(schema, input, [], issues)
        return T.cond(T.eq(T.prop(issues, "length"), 0), T.objectLiteral({ success: true, data }), T.objectLiteral({ success: false, issues }))
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
