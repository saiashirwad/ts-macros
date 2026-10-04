export interface Issue {
  path: (string | number)[]
  expected: string
}

export type SafeParse<T> = { success: true; data: T } | { success: false; issues: Issue[] }

export class ValidationError extends Error {
  readonly issues: Issue[]

  constructor(issues: Issue[]) {
    super(issues.map(({ path, expected }) => `${JSON.stringify(path)} expected ${expected}`).join("\n"))
    this.name = "ValidationError"
    this.issues = issues
  }
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function isString(value: unknown): value is string {
  return typeof value === "string"
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

export const runtime = Object.freeze({
  nullValue: null,
  isObject,
  isArray(value: unknown): boolean {
    return Array.isArray(value)
  },
  arrayItems(value: unknown): readonly unknown[] {
    if (!Array.isArray(value)) throw new TypeError("expected an array")
    return value
  },
  hasOwn(value: unknown, key: string): boolean {
    return isObject(value) && Object.hasOwn(value, key)
  },
  ownRead(value: unknown, key: string): unknown {
    if (!isObject(value) || !Object.hasOwn(value, key)) return undefined
    return value[key]
  },
  defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  },
  stringAtLeast(value: unknown, minimum: number): boolean {
    return isString(value) && value.length >= minimum
  },
  numberMatches(value: unknown, minimum: number | undefined, integer: boolean): boolean {
    return isNumber(value) && (minimum === undefined || value >= minimum) && (!integer || Number.isInteger(value))
  },
})
