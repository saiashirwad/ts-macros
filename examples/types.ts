import { Decl, Expr, Program, Type } from "../src/index.ts"
import { emitProgram } from "../targets/ts.ts"

const T = Type.param("T")
const K = Type.param("K")
const U = Type.param("U")

export const program = Program.build(function*() {
  const Unwrap = yield* Decl.type("Unwrap", {
    params: [T],
    body: Type.conditional(T, Type.promise(Type.infer("U")), U, T),
  })

  const Boxed = yield* Decl.type("Boxed", {
    params: [T],
    body: Type.mapped("K", T, Type.object({ value: Type.index(T, K) })),
  })

  const Config = yield* Decl.type(
    "Config",
    Type.object({
      host: Type.readonly(Type.string),
      port: Type.number,
      debug: Type.optional(Type.boolean),
    }),
  )

  const Port = yield* Decl.type("Port", Type.index(Config, Type.literal("port")))

  const Named = yield* Decl.type("Named", Type.intersection(Config, Type.object({ name: Type.string })))

  const Hook = yield* Decl.type("Hook", Type.template(["on-", ""], Type.union(Type.literal("start"), Type.literal("stop"))))

  const Logger = yield* Decl.type("Logger", Type.fn([Hook], Type.string, Type.array(Type.string)))

  const BoxedConfig = yield* Decl.type("BoxedConfig", Type.apply(Boxed, [Config]))

  const Resolved = yield* Decl.type("Resolved", Type.apply(Unwrap, [Type.promise(Type.number)]))

  const address = yield* Decl.fn("address", {
    params: [Expr.param("config", Named)],
    returns: Type.string,
    body: function*({ config }) {
      return Expr.template(["", "@", ":", ""], Expr.prop(config, "name"), Expr.prop(config, "host"), Expr.prop(config, "port"))
    },
  })

  const log = yield* Decl.fn("log", {
    params: [Expr.param("event", Hook), Expr.rest("parts", Type.string)],
    body: function*({ event, parts }) {
      return Expr.template(["", " (", " parts)"], event, Expr.prop(parts, "length"))
    },
  })

  const server = yield* Decl.const("server", {
    name: "api",
    host: "localhost",
    port: 8080,
  }, Named)
  const port = yield* Decl.const("port", Expr.prop(server, "port"), Port)
  const where = yield* Decl.const("where", Expr.call(address, server))
  const logger = yield* Decl.const("logger", log, Logger)
  const started = yield* Decl.const("started", Expr.call(logger, "on-start", where))
  const boxed = yield* Decl.const("boxed", {
    host: { value: Expr.prop(server, "host") },
    port: { value: port },
  }, BoxedConfig)
  const resolved = yield* Decl.const("resolved", Expr.prop(Expr.prop(boxed, "port"), "value"), Resolved)

  return { started, boxed, resolved }
})

type Boxed = Expr.Denotes<typeof program.result.boxed>
type Resolved = Expr.Denotes<typeof program.result.resolved>
type Started = Expr.Denotes<typeof program.result.started>
export const typeChecks = (boxed: Boxed, resolved: Resolved, started: Started): void => {
  const _portValue: number = boxed.port.value
  const _resolved: number = resolved
  const _started: string = started
  // @ts-expect-error - Unwrap<Promise<number>> is number, not string
  const _notAString: string = resolved
}

console.log(emitProgram(program))
