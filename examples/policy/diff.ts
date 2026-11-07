import { Policy } from "./lib/policy.ts"
import { v1, v2, worlds } from "./policies.ts"

const old = Policy.deserialize(Policy.serialize(v1))
const next = Policy.deserialize(Policy.serialize(v2))

for (const [who, world] of Object.entries(worlds)) {
  const before = Policy.evaluate(old, world)
  const after = Policy.evaluate(next, world)
  const changes = [
    ...after.filter((r) => !before.includes(r)).map((r) => `+${r}`),
    ...before.filter((r) => !after.includes(r)).map((r) => `-${r}`),
  ]
  console.log(`${who.padEnd(30)} ${changes.join(" ") || "same"}`)
}
