import { createHash } from "node:crypto"
import { warehouse } from "./domains.ts"
import { Expr, type Json, Policy } from "./lib/policy.ts"
import { v1 } from "./policies.ts"

const call = (name: string) => ({ kind: "call", callee: { kind: "external", name }, args: [] })
const statement = (expr: Json) => ({ kind: "expr-statement", expr })
const empty = { kind: "block", statements: [] }

const artifacts = {
  "an infinite loop": [{ kind: "while", condition: { kind: "literal", value: true }, body: empty }],
  "a call into the host": [statement(call("process"))],
  "a closure": [statement({ kind: "arrow", params: [], body: empty })],
  "typeof": [statement({ kind: "unary", op: "typeof", operand: { kind: "literal", value: 1 } })],
  "a mutation": [{ kind: "assign", target: { kind: "ref", id: "b0", nameHint: "x" }, value: { kind: "literal", value: 1 } }],
  "a reference to nothing": [statement({ kind: "ref", id: "b9", nameHint: "secret" })],
}

for (const [name, artifact] of Object.entries(artifacts)) {
  try {
    Policy.deserialize(JSON.stringify(artifact))
    console.log(`ACCEPTED ${name}`)
  } catch (error) {
    console.log(`rejected ${name.padEnd(24)} ${error instanceof Error ? error.message.split(" (")[0] : error}`)
  }
}

const hash = (policy: Policy): string => createHash("sha256").update(Policy.serialize(policy)).digest("hex").slice(0, 12)

const build = () =>
  Policy.gen(function*() {
    const placement = yield* warehouse.placement()
    yield* warehouse.when(Expr.eq(Expr.prop(placement, "job"), "forklift"), function*() {
      yield* warehouse.require("safety-training")
    })
  })

console.log(`\nbuilt twice, fresh ids: ${hash(build())} ${hash(build())}`)
console.log(`round trip: ${hash(v1)} ${hash(Policy.deserialize(Policy.serialize(v1)))}`)
