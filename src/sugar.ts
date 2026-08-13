import * as Binding from "./binding.ts"
import { callsiteName, callsiteParamName } from "./callsite.ts"
import * as Expr from "./expr.ts"
import * as FFI from "./ffi.ts"
import * as Fn from "./function.ts"
import { type CheckLift, type Denote, type In, norm, type Surface } from "./norm.ts"
import * as Stmt from "./statement.ts"
import { expr } from "./surface.ts"

export * from "./norm.ts"
export * from "./surface.ts"

// operators — a proxy can't trap `+ - * /`, so these are flat functions, each a
// thin In wrapper over the pure core constructor. they return nodes: an
// operator result is a value, not a chain entry.

export const add = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<"+", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary("+", norm(left as any), norm(right as any))

export const sub = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<"-", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary("-", norm(left as any), norm(right as any))

export const mul = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<"*", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary("*", norm(left as any), norm(right as any))

export const div = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<"/", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary("/", norm(left as any), norm(right as any))

export const eq = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<"===", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary("===", norm(left as any), norm(right as any))

export const neq = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<"!==", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary("!==", norm(left as any), norm(right as any))

export const lt = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<"<", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary("<", norm(left as any), norm(right as any))

export const lte = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<"<=", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary("<=", norm(left as any), norm(right as any))

export const gt = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<">", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary(">", norm(left as any), norm(right as any))

export const gte = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<">=", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary(">=", norm(left as any), norm(right as any))

export const and = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<"&&", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary("&&", norm(left as any), norm(right as any))

export const or = <const L, const R>(
  left: L,
  right: R,
  ..._check: [...CheckLift<L>, ...CheckLift<R>]
): Expr.Binary<"||", Expr.Expr<Denote<L>>, Expr.Expr<Denote<R>>> => Expr.Binary("||", norm(left as any), norm(right as any))

export const not = <const A>(operand: A, ..._check: CheckLift<A>): Expr.Unary<"!", Expr.Expr<Denote<A>>> => Expr.Unary("!", norm(operand as any))

export const typeof_ = <const A>(operand: A, ..._check: CheckLift<A>): Expr.Unary<"typeof", Expr.Expr<Denote<A>>> =>
  Expr.Unary("typeof", norm(operand as any))

// bindings — the builder pipe is the internal construct; these are the whole
// user-facing form. `yield* Const(value)` even names the binding after the
// authoring variable (see callsite.ts); pass a name explicitly when inference
// can't see the callsite.

export function Let(): Binding.BindingBuilder<unknown, "let">
export function Let<const X>(value: X, ..._check: CheckLift<X>): Binding.BindingBuilder<Expr.Widen<Denote<X>>, "let">
export function Let<const Name extends string, const X>(
  name: Name,
  value: X,
  ..._check: CheckLift<X>
): Binding.BindingBuilder<Expr.Widen<Denote<X>>, "let">
export function Let(...args: [] | [In<any>] | [string, In<any>]): Binding.BindingBuilder<any, "let"> {
  if (args.length === 0) return Binding.Let(callsiteName(Let))
  if (args.length === 1) return Binding.Let(callsiteName(Let)).pipe(Binding.Init(args[0]))
  return Binding.Let(args[0]).pipe(Binding.Init(args[1]))
}

export function Const<const X>(value: X, ..._check: CheckLift<X>): Binding.BindingBuilder<Expr.ConstWiden<Denote<X>>, "const">
export function Const<const Name extends string, const X>(
  name: Name,
  value: X,
  ..._check: CheckLift<X>
): Binding.BindingBuilder<Expr.ConstWiden<Denote<X>>, "const">
export function Const(...args: [In<any>] | [string, In<any>]): Binding.BindingBuilder<any, "const"> {
  if (args.length === 1) return Binding.Const(callsiteName(Const)).pipe(Binding.Init(args[0]))
  if (args[1] === undefined) throw new Error(`const "${args[0]}" requires an initializer`)
  return Binding.Const(args[0]).pipe(Binding.Init(args[1]))
}

/** Assign with lifted values: `$.Assign(grade, "A+")` — the readonly check still applies */
export const Assign = <const T extends Expr.LValue, const V extends In<Expr.Denotes<T>>>(
  target: T,
  value: V,
  ..._check: Expr.IsWritableTarget<T> extends false ? ["cannot assign to a readonly prop"] : []
): Expr.Assign<T, Expr.Expr<Expr.Denotes<T>>> => Expr.Assign(target, norm(value as any), ..._check)

/** a whole function declaration in one call — name from the callsite, no pipe, no Params wrapper */
export function fun<const P extends Fn.AnyParams, Yields extends Stmt.Statement, const TR>(
  params: [...P],
  impl: (bindings: Fn.ParamBindings<P>) => Generator<Yields, TR, unknown>,
): Fn.FunctionBuilder<P, Denote<TR> | Stmt.ReturnValue<Yields>, []>
export function fun<const Name extends string, const P extends Fn.AnyParams, Yields extends Stmt.Statement, const TR>(
  name: Name,
  params: [...P],
  impl: (bindings: Fn.ParamBindings<P>) => Generator<Yields, TR, unknown>,
): Fn.FunctionBuilder<P, Denote<TR> | Stmt.ReturnValue<Yields>, []>
export function fun(...args: [Fn.AnyParams, any] | [string, Fn.AnyParams, any]): Fn.FunctionBuilder<any, any, any> {
  const [name, params, impl] = (typeof args[0] === "string" ? args : [callsiteName(fun), ...args]) as [string, Fn.AnyParams, any]
  return Fn.Function(name).pipe(Fn.Params(...params), Fn.Impl(impl))
}

/** a typed module import as a surface: `$.import_<Linalg>("linalg").matrix(2, 2)` */
export const import_ = <A = unknown>(source: string, local?: string): Surface<A> => expr(FFI.Import<A>(source, local))

/** a typed global as a surface: `$.ref<Console>("console").log("hi")` */
export const ref = <A = unknown>(name: string): Surface<A> => expr(FFI.Value<A>(name))

/** ForOf with the loop variable read from the body param: `$.forOf(numbers, function*(n) { ... })` */
export function forOf<E, const B extends (item: Expr.VarRef<E, false>) => Generator<Stmt.Statement, void, unknown>>(
  iterable: In<readonly E[]>,
  body: B,
): Stmt.ForOfBuilder<Stmt.PhantomReturns<B>>
export function forOf<const B extends (item: Expr.VarRef<string, false>) => Generator<Stmt.Statement, void, unknown>>(
  iterable: In<string>,
  body: B,
): Stmt.ForOfBuilder<Stmt.PhantomReturns<B>>
export function forOf<const Name extends string, E, const B extends (item: Expr.VarRef<E, false>) => Generator<Stmt.Statement, void, unknown>>(
  name: Name,
  iterable: In<readonly E[]>,
  body: B,
): Stmt.ForOfBuilder<Stmt.PhantomReturns<B>>
export function forOf<const Name extends string, const B extends (item: Expr.VarRef<string, false>) => Generator<Stmt.Statement, void, unknown>>(
  name: Name,
  iterable: In<string>,
  body: B,
): Stmt.ForOfBuilder<Stmt.PhantomReturns<B>>
export function forOf(...args: [In<any>, any] | [string, In<any>, any]): Stmt.ForOfBuilder<any> {
  if (args.length === 2) return Stmt.ForOf(callsiteParamName(forOf), args[0], args[1])
  return Stmt.ForOf(args[0], args[1], args[2])
}
