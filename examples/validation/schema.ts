export type Literal = string | number | boolean | null

export type Schema =
  | { readonly kind: "string"; readonly minLength: number }
  | { readonly kind: "number"; readonly min: number | undefined; readonly integer: boolean }
  | { readonly kind: "boolean" }
  | { readonly kind: "literal"; readonly value: Literal }
  | { readonly kind: "array"; readonly item: Schema }
  | { readonly kind: "object"; readonly fields: Readonly<Record<string, Schema>> }
  | { readonly kind: "optional"; readonly item: Schema }

type OptionalKeys<F> = { [K in keyof F]: Extract<F[K], { readonly kind: "optional" }> extends never ? never : K }[keyof F]
type ObjectOutput<F extends Readonly<Record<string, Schema>>> =
  & { -readonly [K in Exclude<keyof F, OptionalKeys<F>>]: Infer<F[K]> }
  & { -readonly [K in OptionalKeys<F>]?: Infer<F[K]> }

export type Infer<S extends Schema> =
    Schema extends S ? unknown
  : S extends { readonly kind: "string" } ? string
  : S extends { readonly kind: "number" } ? number
  : S extends { readonly kind: "boolean" } ? boolean
  : S extends { readonly kind: "literal"; readonly value: infer V } ? V
  : S extends { readonly kind: "array"; readonly item: infer I extends Schema } ? Infer<I>[]
  : S extends { readonly kind: "object"; readonly fields: infer F extends Readonly<Record<string, Schema>> } ? ObjectOutput<F>
  : S extends { readonly kind: "optional"; readonly item: infer I extends Schema } ? Infer<I> | undefined
  : never

function isNumericLiteral(value: Literal): value is number {
  return typeof value === "number"
}

export function objectFields(fields: Readonly<Record<string, Schema>>): [string, Schema][] {
  const prototype = Object.getPrototypeOf(fields)
  if (prototype !== null && prototype !== Object.prototype) throw new TypeError("schema fields must be a plain object")
  if (Object.getOwnPropertySymbols(fields).length !== 0) throw new TypeError("schema fields must use string keys")
  for (const key of Object.getOwnPropertyNames(fields)) {
    const descriptor = Object.getOwnPropertyDescriptor(fields, key)
    if (!descriptor?.enumerable || !("value" in descriptor)) throw new TypeError("schema fields must be enumerable data properties")
  }
  return Object.entries(fields)
}

export const schema = {
  string(minLength = 0) {
    if (!Number.isSafeInteger(minLength) || minLength < 0) throw new RangeError("minLength must be a nonnegative safe integer")
    return Object.freeze({ kind: "string", minLength } satisfies Schema)
  },
  number(min?: number, integer = false) {
    if (min !== undefined && !Number.isFinite(min)) throw new RangeError("min must be finite")
    return Object.freeze({ kind: "number", min, integer } satisfies Schema)
  },
  boolean() {
    return Object.freeze({ kind: "boolean" } satisfies Schema)
  },
  literal<const V extends Literal>(value: V): Readonly<{ kind: "literal"; value: V }> {
    if (isNumericLiteral(value) && !Number.isFinite(value)) throw new RangeError("numeric literals must be finite")
    return Object.freeze({ kind: "literal", value })
  },
  array<const I extends Schema>(item: I): Readonly<{ kind: "array"; item: I }> {
    return Object.freeze({ kind: "array", item })
  },
  object<const F extends Readonly<Record<string, Schema>>>(fields: F): Readonly<{ kind: "object"; fields: Readonly<F> }> {
    objectFields(fields)
    return Object.freeze({ kind: "object", fields: Object.freeze({ ...fields }) })
  },
  optional<const I extends Schema>(item: I): Readonly<{ kind: "optional"; item: I }> {
    return Object.freeze({ kind: "optional", item })
  },
}
