import { explain } from "./lib/explain.ts"
import { v2 } from "./policies.ts"

console.log(explain(v2).join("\n"))
