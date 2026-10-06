import * as T from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

const TParam = T.TypeParam("T")
const K = T.TypeParam("K")
const U = T.TypeParam("U")

export const program = T.build(function*() {
  const Unwrap = yield* T.type("Unwrap", {
    params: [TParam],
    body: T.Conditional(TParam, T.Promise(T.Infer("U")), U, TParam),
  })

  const Boxed = yield* T.type("Boxed", {
    params: [TParam],
    body: T.Mapped("K", TParam, T.Object({ value: T.IndexedAccess(TParam, K) })),
  })

  const Config = yield* T.type(
    "Config",
    T.Object({
      host: T.Readonly(T.String),
      port: T.Number,
      debug: T.Optional(T.Boolean),
    }),
  )

  const Port = yield* T.type("Port", T.IndexedAccess(Config, T.Literal("port")))

  const Named = yield* T.type("Named", T.Intersection(Config, T.Object({ name: T.String })))

  const Hook = yield* T.type("Hook", T.Template(["on-", ""], T.Union(T.Literal("start"), T.Literal("stop"))))

  const Logger = yield* T.type("Logger", T.Function([Hook], T.String, T.Array(T.String)))

  const BoxedConfig = yield* T.type("BoxedConfig", T.Apply(Boxed, [Config]))

  const Resolved = yield* T.type("Resolved", T.Apply(Unwrap, [T.Promise(T.Number)]))

  const address = yield* T.fn("address", {
    params: [T.param("config", Named)],
    returns: T.String,
    body: function*({ config }) {
      return T.template(["", "@", ":", ""], T.prop(config, "name"), T.prop(config, "host"), T.prop(config, "port"))
    },
  })

  const log = yield* T.fn("log", {
    params: [T.param("event", Hook), T.rest("parts", T.String)],
    body: function*({ event, parts }) {
      return T.template(["", " (", " parts)"], event, T.prop(parts, "length"))
    },
  })

  const server = yield* T.const("server", {
    name: "api",
    host: "localhost",
    port: 8080,
  }, Named)
  const port = yield* T.const("port", T.prop(server, "port"), Port)
  const where = yield* T.const("where", T.call(address, server))
  const logger = yield* T.const("logger", log, Logger)
  const started = yield* T.const("started", T.call(logger, "on-start", where))
  const boxed = yield* T.const("boxed", {
    host: { value: T.prop(server, "host") },
    port: { value: port },
  }, BoxedConfig)
  const resolved = yield* T.const("resolved", T.prop(T.prop(boxed, "port"), "value"), Resolved)

  return { started, boxed, resolved }
})

type Boxed = T.Denotes<typeof program.result.boxed>
type Resolved = T.Denotes<typeof program.result.resolved>
type Started = T.Denotes<typeof program.result.started>
export const typeChecks = (boxed: Boxed, resolved: Resolved, started: Started): void => {
  const _portValue: number = boxed.port.value
  const _resolved: number = resolved
  const _started: string = started
  // @ts-expect-error - Unwrap<Promise<number>> is number, not string
  const _notAString: string = resolved
}

console.log(emitProgram(program))
