# Policy

Serializable policies written in TypeScript with `ts-macros`.

- From the serialized policy you can:
  - list the inputs it reads (`reads`)
  - render it as sentences (`explain`)
  - generate inputs that cover every branch (`generateScenarios`)
  - solve the days a date rule fires (`fireWindows`)
- A policy can nest conditions, use `otherwise`, reuse lookups and call helpers.

With `ts-macros` you write all of that in a type-safe DSL:

- It has `const`, `if` / `else` and helper functions.
- TypeScript checks every name and type.
- The result is serializable.

## Example

```ts
const depot = defineDomain({
  jobs: ["forklift", "cdl-driver", "warehouse-associate"],
  states: ["IL", "CA"],
  evidence: ["forklift-certification"],
  requirements: [
    "forklift-certification",
    "license-upload",
    "drug-screen",
    "site-safety",
    "general-orientation",
    "il-w4",
  ],
  tasks: [],
  dates: [],
})

const policy = Policy.gen(function*() {
  const placement = yield* depot.placement()
  const job = Expr.prop(placement, "job")
  const worker = Expr.prop(placement, "workerId")
  const startsAt = Expr.prop(placement, "startsAt")

  yield* depot.perState({ IL: "il-w4" })

  yield* depot.when(Expr.eq(job, "forklift"), function*() {
    yield* depot.require("site-safety")
    const certification = yield* depot.evidence.find({
      worker,
      kind: "forklift-certification",
    })
    const certified = yield* depot.evidence.validAt(certification, startsAt)
    yield* depot.when(Expr.not(certified), function*() {
      yield* depot.require("forklift-certification")
    })
  }).pipe(
    depot.elseWhen(Expr.eq(job, "cdl-driver"), function*() {
      yield* depot.require("license-upload")
      yield* depot.require("drug-screen")
    }),
    depot.otherwise(function*() {
      yield* depot.require("general-orientation")
    }),
  )
})
```

The certification lookup sits inside the forklift branch. `evaluate` only runs it for forklift workers.

## The artifact is data

```ts
const artifact = Policy.serialize(policy)
const restored = depot.deserialize(artifact)
```

```json
[{"kind":"const-declaration","id":"b0","nameHint":"placement",
  "expr":{"kind":"call","callee":{"kind":"external","name":"placement"},"args":[]}}, ...]
```

- `artifact` is plain JSON: declarations, conditions and host calls.
- `depot.deserialize` rejects names the company never defined.
- Binding ids are renumbered, so two builds of the same program give identical JSON.

Evaluate the restored policy for four workers:

```ts
const evidence = [{
  worker: "ana",
  kind: "forklift-certification",
  expiresAt: "2027-01-01",
}]
const workers = [
  { workerId: "ana", job: "forklift", state: "IL", startsAt: "2026-06-01" },
  { workerId: "bo", job: "forklift", state: "CA", startsAt: "2026-06-01" },
  { workerId: "cy", job: "cdl-driver", state: "CA", startsAt: "2026-06-01" },
  {
    workerId: "di",
    job: "warehouse-associate",
    state: "IL",
    startsAt: "2026-06-01",
  },
] as const

for (const placement of workers) {
  console.log(
    placement.workerId,
    Policy.evaluate(restored, { placement, evidence }),
  )
}
```

```
ana [ 'il-w4', 'site-safety' ]
bo [ 'site-safety', 'forklift-certification' ]
cy [ 'license-upload', 'drug-screen' ]
di [ 'il-w4', 'general-orientation' ]
```

## One artifact, several interpreters

```
        TypeScript generators
                 │
                 ▼
             ts-macros
                 │
                 ▼
        Serializable program
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
  evaluate    analyze     explain
     │           │           │
     ▼           ▼           ▼
requirements  dependencies  policy review
```

| Interpreter | File              | What it demonstrates                                           |
| ----------- | ----------------- | -------------------------------------------------------------- |
| `evaluate`  | `lib/evaluate.ts` | Run a policy against concrete worker facts                     |
| `analyze`   | `lib/analyze.ts`  | List the requirements it can ask for and the data it reads     |
| `explain`   | `lib/explain.ts`  | Render the policy's structure as sentences                     |
| `coverage`  | `lib/coverage.ts` | Generate worlds that take each discovered branch both ways     |
| `solve`     | `lib/solve.ts`    | Derive the days a time rule fires, for `today + n` comparisons |

Each one reads the same JSON. None of them knows the generator code.
