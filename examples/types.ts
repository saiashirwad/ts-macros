// The type AST covers the type-level operators TypeScript has: conditional
// types with `infer`, mapped types, keyof, indexed access, intersections,
// template literal types, field modifiers, and rest parameters.
//
// Every `yield*` hands back a reference, and every reference here feeds a
// later line. The types are declared, then applied, then used to annotate
// values; the values are built from each other. Nothing is emitted that the
// program does not also use.

import * as Binding from "../src/binding.ts"
import * as Expr from "../src/expr.ts"
import * as Fn from "../src/function.ts"
import * as Program from "../src/program.ts"
import * as Type from "../src/types/index.ts"
import { emitProgram as emitProgramTypeScript } from "../targets/typescript/index.ts"

const T = Type.Param("T")
const K = Type.Param("K")
const U = Type.Param("U")

export const program = Program.build(function*() {
  // type Unwrap<T> = T extends Promise<infer U> ? U : T
  //
  // Type.Promise knows what a promise denotes, so the phantom can match the
  // pattern; a bare Type.Ref("Promise", ...) would emit the same text but
  // denote nothing
  const Unwrap = yield* Type.Type("Unwrap", Type.Conditional(T, Type.Promise(Type.InferVar("U")), U, T)).pipe(Type.TypeParams(T))

  // type Boxed<T> = { [K in keyof T]: { value: T[K] } }
  const Boxed = yield* Type.Type("Boxed", Type.Mapped("K", T, Type.Object({ value: Type.Index(T, K) }))).pipe(Type.TypeParams(T))

  // type Config = { readonly host: string; port: number; debug?: boolean }
  const Config = yield* Type.Type(
    "Config",
    Type.Object({
      host: Type.Readonly(Type.String()),
      port: Type.Number(),
      debug: Type.Optional(Type.Boolean()),
    }),
  )

  // type Port = Config["port"]
  const Port = yield* Type.Type("Port", Type.Index(Config, Type.Literal("port")))

  // type Named = Config & { name: string }
  const Named = yield* Type.Type("Named", Type.Intersection(Config, Type.Object({ name: Type.String() })))

  // type Hook = `on-${"start" | "stop"}`
  const Hook = yield* Type.Type("Hook", Type.TemplateLiteral(["on-", ""], Type.Union(Type.Literal("start"), Type.Literal("stop"))))

  // type Logger = (arg0: Hook, ...arg1: string[]) => string
  const Logger = yield* Type.Type("Logger", Type.Function([Hook], Type.String(), Type.Array(Type.String())))

  // type BoxedConfig = Boxed<Config>
  const BoxedConfig = yield* Type.Type("BoxedConfig", Type.Apply(Boxed, [Config]))

  // type Resolved = Unwrap<Promise<number>>
  const Resolved = yield* Type.Type("Resolved", Type.Apply(Unwrap, [Type.Promise(Type.Number())]))

  // functions over the declared types
  const address = yield* Fn.Function("address").pipe(
    Fn.Params(Fn.Param("config", Named)),
    Fn.Returns(Type.String()),
    Fn.Impl(function*({ config }) {
      return Expr.Template(["", "@", ":", ""], Expr.Prop(config, "name"), Expr.Prop(config, "host"), Expr.Prop(config, "port"))
    }),
  )

  const log = yield* Fn.Function("log").pipe(
    Fn.Params(Fn.Param("event", Hook), Fn.Rest("parts", Type.String())),
    Fn.Impl(function*({ event, parts }) {
      return Expr.Template(["", " (", " parts)"], event, Expr.Prop(parts, "length"))
    }),
  )

  // values annotated with them, each built from the ones before
  const server = yield* Binding.Const("server").pipe(
    Binding.Annotate(Named),
    Binding.Init(Expr.Object({ name: Expr.String("api"), host: Expr.String("localhost"), port: Expr.Number(8080) })),
  )
  const port = yield* Binding.Const("port").pipe(Binding.Annotate(Port), Binding.Init(Expr.Prop(server, "port")))
  const where = yield* Binding.Const("where").pipe(Binding.Init(Fn.Call(address, server)))
  const logger = yield* Binding.Const("logger").pipe(Binding.Annotate(Logger), Binding.Init(log))
  const started = yield* Binding.Const("started").pipe(Binding.Init(Fn.Call(logger, Expr.String("on-start"), where)))
  const boxed = yield* Binding.Const("boxed").pipe(
    Binding.Annotate(BoxedConfig),
    Binding.Init(Expr.Object({
      host: Expr.Object({ value: Expr.Prop(server, "host") }),
      port: Expr.Object({ value: port }),
    })),
  )
  const resolved = yield* Binding.Const("resolved").pipe(Binding.Annotate(Resolved), Binding.Init(Expr.Prop(Expr.Prop(boxed, "port"), "value")))

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
