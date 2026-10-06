import * as $ from "../../src/index.ts"
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

const helpers = $.hostValue<typeof runtime>("runtime")
const undefinedValue = $.hostValue<undefined>("undefined")
const number = $.hostValue<typeof Number>("Number")
const array = $.hostValue<typeof Array>("Array")
const issueType = $.Object({ path: $.Array($.Union($.String, $.Number)), expected: $.String })
type Path = readonly $.In<string | number>[]

function* lower(
  node: Schema,
  input: $.Expr<unknown>,
  path: Path,
  issues: $.Expr<Issue[]>,
): Generator<$.NonLoopStatement, $.Expr<unknown>, unknown> {
  const output = yield* $.let("value", undefinedValue, $.Unknown)

  function* fail(expected: string) {
    yield* $.do($.call($.prop(issues, "push"), $.object({ path: $.array(...path), expected })))
  }

  function* scalar(valid: $.Expr<boolean>, expected: string, value: $.Expr<unknown> = input) {
    yield* $.else(function*() {
      yield* fail(expected)
    })($.if(valid, function*() {
      yield* $.assign(output, value)
    }))
  }

  function* guardedScalar<T>(guard: $.Guard<T>, constraint: (value: $.Expr<T>) => $.Expr<boolean>, expected: string, nameHint: string) {
    const ok = yield* $.let("ok", false)
    yield* $.ifGuard(guard, function*(value) {
      yield* $.assign(ok, constraint(value))
    }, nameHint)
    yield* scalar(ok, expected)
  }

  switch (node.kind) {
    case "string": {
      const expected = `string with at least ${node.minLength} characters`
      yield* guardedScalar($.isTypeof(input, "string"), (text) => $.gte($.prop(text, "length"), node.minLength), expected, "text")
      break
    }
    case "number": {
      const expected = `finite ${node.integer ? "integer" : "number"}${node.min === undefined ? "" : ` >= ${node.min}`}`
      yield* guardedScalar(
        $.isTypeof(input, "number"),
        (numeric) => {
          let valid: $.Expr<boolean> = $.call($.prop(number, "isFinite"), numeric)
          if (node.min !== undefined) valid = $.and(valid, $.gte(numeric, node.min))
          if (node.integer) valid = $.and(valid, $.call($.prop(number, "isInteger"), numeric))
          return valid
        },
        expected,
        "numeric",
      )
      break
    }
    case "boolean":
      yield* $.ifGuard($.isTypeof(input, "boolean"), function*(boolean) {
        yield* $.assign(output, boolean)
      }, "boolean").pipe($.else(function*() {
        yield* fail("boolean")
      }))
      break
    case "literal":
      yield* scalar($.eq(input, node.value === null ? $.null() : $.lift(node.value)), JSON.stringify(node.value))
      break
    case "optional":
      yield* $.if($.neq(input, undefinedValue), function*() {
        const value = yield* lower(node.item, input, path, issues)
        yield* $.assign(output, value)
      })
      break
    case "array":
      yield* $.else(function*() {
        yield* fail("array")
      })($.ifGuard($.isArray(input), function*(items) {
        const values = yield* $.const("values", $.array(), $.Array($.Unknown))
        const index = yield* $.let("index", 0)
        yield* $.while($.lt(index, $.prop(items, "length")), function*() {
          const item = yield* $.const("item", $.index(items, index))
          const value = yield* lower(node.item, item, [...path, index], issues)
          yield* $.do($.call($.prop(values, "push"), value))
          yield* $.assign(index, $.add(index, 1))
        })
        yield* $.assign(output, values)
      }, "items"))
      break
    case "object": {
      const ok = yield* $.let("ok", false)
      yield* $.ifGuard($.allOf($.isTypeof(input, "object"), $.notNullish(input)), function*(record) {
        yield* $.if($.not($.call($.prop(array, "isArray"), record)), function*() {
          const object = yield* $.const("object", $.object({}))
          for (const [key, child] of objectFields(node.fields)) {
            function* field() {
              const inputField = yield* $.const("field", $.call($.prop(helpers, "ownRead"), record, key), $.Unknown)
              const value = yield* lower(child, inputField, [...path, key], issues)
              yield* $.do($.call($.prop(helpers, "defineOwn"), object, key, value))
            }
            if (child.kind === "optional") {
              yield* $.if($.hasOwn(record, key).condition, field)
            } else {
              yield* field()
            }
          }
          yield* $.assign(output, object)
          yield* $.assign(ok, true)
        })
      }, "record")
      yield* $.if($.not(ok), function*() {
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
  const program = $.build(function*() {
    yield* $.fn("validate", {
      params: [$.param("input", $.Unknown)],
      body: function*({ input }) {
        const issues = yield* $.const("issues", $.array(), $.Array(issueType))
        const data = yield* lower(schema, input, [], issues)
        return $.cond($.eq($.prop(issues, "length"), 0), $.object({ success: true, data }), $.object({ success: false, issues }))
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
