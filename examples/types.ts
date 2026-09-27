// The type AST covers the type-level operators TypeScript has: conditional
// types with `infer`, mapped types, keyof, indexed access, intersections,
// template literal types, field modifiers, and rest parameters.
//
// Every `yield*` hands back a reference, and every reference here feeds a
// later line. The types are declared, then applied, then used to annotate
// values; the values are built from each other. Nothing is emitted that the
// program does not also use.

import { Decl, Expr, Program, Type } from "../src/index.ts"
import { emitProgram as emitProgramTypeScript } from "../targets/typescript/index.ts"

const T = Type.param("T")
const K = Type.param("K")
const U = Type.param("U")

export const program = Program.build(function*() {
  // type Unwrap<T> = T extends Promise<infer U> ? U : T
  //
  // Type.promise knows what a promise denotes, so the phantom can match the
  // pattern; a bare FFI.Type("Promise", ...) would emit the same text but
  // denote nothing
  const Unwrap = yield* Decl.type_("Unwrap", {
    params: [T],
    body: Type.conditional(T, Type.promise(Type.infer_("U")), U, T),
  })

  // type Boxed<T> = { [K in keyof T]: { value: T[K] } }
  const Boxed = yield* Decl.type_("Boxed", {
    params: [T],
    body: Type.mapped("K", T, Type.object({ value: Type.index(T, K) })),
  })

  // type Config = { readonly host: string; port: number; debug?: boolean }
  const Config = yield* Decl.type_(
    "Config",
    Type.object({
      host: Type.readonly_(Type.string),
      port: Type.number,
      debug: Type.optional(Type.boolean),
    }),
  )

  // type Port = Config["port"]
  const Port = yield* Decl.type_("Port", Type.index(Config, Type.literal("port")))

  // type Named = Config & { name: string }
  const Named = yield* Decl.type_("Named", Type.intersection(Config, Type.object({ name: Type.string })))

  // type Hook = `on-${"start" | "stop"}`
  const Hook = yield* Decl.type_("Hook", Type.template(["on-", ""], Type.union(Type.literal("start"), Type.literal("stop"))))

  // type Logger = (arg0: Hook, ...arg1: string[]) => string
  const Logger = yield* Decl.type_("Logger", Type.fn([Hook], Type.string, Type.array(Type.string)))

  // type BoxedConfig = Boxed<Config>
  const BoxedConfig = yield* Decl.type_("BoxedConfig", Type.apply(Boxed, [Config]))

  // type Resolved = Unwrap<Promise<number>>
  const Resolved = yield* Decl.type_("Resolved", Type.apply(Unwrap, [Type.promise(Type.number)]))

  // functions over the declared types
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

  // values annotated with them, each built from the ones before
  const server = yield* Decl.const_("server", {
    name: "api",
    host: "localhost",
    port: 8080,
  }, Named)
  const port = yield* Decl.const_("port", Expr.prop(server, "port"), Port)
  const where = yield* Decl.const_("where", Expr.call(address, server))
  const logger = yield* Decl.const_("logger", log, Logger)
  const started = yield* Decl.const_("started", Expr.call(logger, "on-start", where))
  const boxed = yield* Decl.const_("boxed", {
    host: { value: Expr.prop(server, "host") },
    port: { value: port },
  }, BoxedConfig)
  const resolved = yield* Decl.const_("resolved", Expr.prop(Expr.prop(boxed, "port"), "value"), Resolved)

  return { started, boxed, resolved }
})

// The phantoms follow the operators, so these checks happen in the compiler
// while building the program, not by running its output.
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

console.log(emitProgramTypeScript(program))
