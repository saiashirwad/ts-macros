import { fireWindows, nextFires } from "./lib/solve.ts"
import { permits } from "./policies.ts"

const date = (day: number): string => (Number.isFinite(day) ? new Date(day * 86_400_000).toISOString().slice(0, 10) : day > 0 ? "forever" : "always")

const worker = { id: "ana", permitExpiresDay: 20_600 }
console.log(`permit expires ${date(worker.permitExpiresDay)}`)

const fires = fireWindows(permits, worker)
for (const { task, window } of fires) console.log(`${task.padEnd(16)} ${date(window.from)} .. ${date(window.to)}`)

for (const from of [20_000, 20_595, 20_700]) {
  const next = [...nextFires(fires, from)].map(([task, day]) => `${task} on ${date(day)}`)
  console.log(`from ${date(from)}: ${next.join(", ") || "nothing"}`)
}
