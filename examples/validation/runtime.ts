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

export const runtime = Object.freeze({
  ownRead(value: unknown, key: string): unknown {
    if (!isObject(value) || !Object.hasOwn(value, key)) return undefined
    return value[key]
  },
  defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true })
  },
})
