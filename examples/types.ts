import * as $ from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

const T = $.TypeParam("T")
const K = $.TypeParam("K")
const U = $.TypeParam("U")

export const program = $.build(function*() {
  const Unwrap = yield* $.type("Unwrap", {
    params: [T],
    body: $.Conditional(T, $.Promise($.Infer("U")), U, T),
  })

  const Boxed = yield* $.type("Boxed", {
    params: [T],
    body: $.Mapped("K", T, $.Object({ value: $.IndexedAccess(T, K) })),
  })

  const Config = yield* $.type(
    "Config",
    $.Object({
      host: $.Readonly($.String),
      port: $.Number,
      debug: $.Optional($.Boolean),
    }),
  )

  const Port = yield* $.type("Port", $.IndexedAccess(Config, $.Literal("port")))

  const Named = yield* $.type("Named", $.Intersection(Config, $.Object({ name: $.String })))

  const Hook = yield* $.type("Hook", $.Template(["on-", ""], $.Union($.Literal("start"), $.Literal("stop"))))

  const Logger = yield* $.type("Logger", $.Function([Hook], $.String, $.Array($.String)))

  const BoxedConfig = yield* $.type("BoxedConfig", $.Apply(Boxed, [Config]))

  const Resolved = yield* $.type("Resolved", $.Apply(Unwrap, [$.Promise($.Number)]))

  const address = yield* $.fn("address", {
    params: [$.param("config", Named)],
    returns: $.String,
    body: function*({ config }) {
      return $.template(["", "@", ":", ""], $.prop(config, "name"), $.prop(config, "host"), $.prop(config, "port"))
    },
  })

  const log = yield* $.fn("log", {
    params: [$.param("event", Hook), $.rest("parts", $.String)],
    body: function*({ event, parts }) {
      return $.template(["", " (", " parts)"], event, $.prop(parts, "length"))
    },
  })

  const server = yield* $.const("server", {
    name: "api",
    host: "localhost",
    port: 8080,
  }, Named)
  const port = yield* $.const("port", $.prop(server, "port"), Port)
  const where = yield* $.const("where", $.call(address, server))
  const logger = yield* $.const("logger", log, Logger)
  const started = yield* $.const("started", $.call(logger, "on-start", where))
  const boxed = yield* $.const("boxed", {
    host: { value: $.prop(server, "host") },
    port: { value: port },
  }, BoxedConfig)
  const resolved = yield* $.const("resolved", $.prop($.prop(boxed, "port"), "value"), Resolved)

  return { started, boxed, resolved }
})

type Boxed = $.Denotes<typeof program.result.boxed>
type Resolved = $.Denotes<typeof program.result.resolved>
type Started = $.Denotes<typeof program.result.started>
export const typeChecks = (boxed: Boxed, resolved: Resolved, started: Started): void => {
  const _portValue: number = boxed.port.value
  const _resolved: number = resolved
  const _started: string = started
  // @ts-expect-error - Unwrap<Promise<number>> is number, not string
  const _notAString: string = resolved
}

console.log(emitProgram(program))
