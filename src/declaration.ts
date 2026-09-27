// Declarations: the statements that introduce a name. Yielding a builder
// appends its declaration and hands back a reference to the name.

import {
  type AnyParams,
  type CheckLift,
  type CheckParams,
  type Denotes,
  type Expr,
  type FnRef,
  type Lift,
  lift,
  type ParamBindings,
  type Ref,
  ref,
  type Value,
} from "./expr.ts"
import { type BindingId, freshBindingId, type ValueBinding } from "./identity.ts"
import { Builder, isType, makeStatement, type Node } from "./node.ts"
import type { Block, NonLoopStatement, ReturnValue } from "./statement.ts"
import * as Type from "./types/index.ts"
import { bindingType, type ConstType, type IsFresh, isFresh, signatureType, type WidenFresh, type WidenReturn } from "./typing.ts"

// let and const

export type BindingKind = "let" | "const"

export interface BindingDeclaration extends ValueBinding {
  readonly kind: "let-declaration" | "const-declaration"
  readonly id: BindingId
  readonly nameHint: string
  readonly expr?: Expr<any> | undefined
  readonly annotation?: Type.Type<any> | undefined
  /** the binding's type: the annotation, or what the initializer infers to */
  readonly type?: Type.Type<any> | undefined
}

type Mutability<Kind extends BindingKind> = Kind extends "let" ? true : false

/** a `let` or `const` that yields its declaration and hands back a reference */
export class BindingBuilder<A = unknown, Kind extends BindingKind = "let", Fresh extends boolean = false> extends Builder {
  readonly declaration: BindingDeclaration

  constructor(declaration: BindingDeclaration) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<BindingDeclaration, Ref<A, Mutability<Kind>, Fresh>, unknown> {
    const { annotation, expr, id, nameHint, kind, type } = this.declaration
    yield makeStatement(this.declaration)
    const fresh = kind === "const-declaration" && annotation === undefined && expr !== undefined && isFresh(expr)
    return ref(id, nameHint, type, (kind === "let-declaration") as Mutability<Kind>, fresh as Fresh)
  }
}

type CheckInit<Annotation, A> = [A] extends [Annotation] ? unknown : ["the initializer", A, "is not assignable to the annotation", Annotation]

const declare = (
  kind: BindingDeclaration["kind"],
  nameHint: string,
  expr: Expr<any> | undefined,
  annotation: Type.Type<any> | undefined,
): BindingBuilder<any, any, any> =>
  new BindingBuilder({
    kind,
    id: freshBindingId(),
    nameHint,
    expr,
    annotation,
    type: annotation ?? (expr === undefined ? undefined : bindingType(kind, undefined, expr)),
  })

/**
 * `let name = init`, `let name: annotation = init`, or `let name: annotation`.
 * A lone type node is a declaration with no initializer.
 */
export function let_<A>(name: string, annotation: Type.Type<A>): BindingBuilder<A, "let", false>
export function let_<const E>(name: string, init: E, ..._check: CheckLift<E>): BindingBuilder<WidenFresh<Lift<E>>, "let", false>
export function let_<A, const E>(
  name: string,
  init: E,
  annotation: Type.Type<A>,
  ..._check: [...CheckLift<E>, ...(CheckInit<A, Value<E>> extends unknown[] ? CheckInit<A, Value<E>> : [])]
): BindingBuilder<A, "let", false>
export function let_(name: string, initOrAnnotation: unknown, annotation?: unknown): BindingBuilder<any, "let", false> {
  if (annotation === undefined && isType(initOrAnnotation)) return declare("let-declaration", name, undefined, initOrAnnotation)
  const expr = lift(initOrAnnotation as never)
  const note = annotation as Type.Type<any> | undefined
  return declare("let-declaration", name, expr, note)
}

/** `const name = init`, or `const name: annotation = init` */
export function const_<const E>(
  name: string,
  init: E,
  ..._check: CheckLift<E>
): BindingBuilder<ConstType<Lift<E>>, "const", IsFresh<Lift<E>>>
export function const_<A, const E>(
  name: string,
  init: E,
  annotation: Type.Type<A>,
  ..._check: [...CheckLift<E>, ...(CheckInit<A, Value<E>> extends unknown[] ? CheckInit<A, Value<E>> : [])]
): BindingBuilder<A, "const", false>
export function const_(name: string, init: unknown, annotation?: unknown): BindingBuilder<any, "const", any> {
  return declare("const-declaration", name, lift(init as never), annotation as Type.Type<any> | undefined)
}

// functions

export type FunctionImpl<Params extends AnyParams, Return> = (
  bindings: ParamBindings<Params>,
) => Generator<NonLoopStatement, Expr<Return>, unknown>

/** a declaration carries `impl` until `Program.build` runs it and replaces it with `body` */
export interface FunctionDeclaration<
  Params extends AnyParams = AnyParams,
  Return = unknown,
  TypeParams extends Type.AnyParams = Type.AnyParams,
> extends ValueBinding, Node {
  readonly kind: "function-declaration"
  readonly id: BindingId
  readonly nameHint: string
  readonly typeParams: TypeParams
  readonly params: Params
  readonly returnType?: Type.Type<Return> | undefined
  readonly type?: Type.FunctionType | undefined
  readonly impl?: FunctionImpl<Params, Return> | undefined
  readonly body?: Block | undefined
}

/** yields the declaration and hands back a reference, generic when `typeParams` is non-empty */
export class FunctionBuilder<Params extends AnyParams = [], Return = unknown, TypeParams extends Type.AnyParams = []> extends Builder {
  readonly declaration: FunctionDeclaration<Params, Return, TypeParams>

  constructor(declaration: FunctionDeclaration<Params, Return, TypeParams>) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<FunctionDeclaration<Params, Return, TypeParams>, FnRef<Params, Return, TypeParams>, unknown> {
    yield makeStatement(this.declaration)
    const { id, nameHint, params, returnType, typeParams } = this.declaration
    return ref(id, nameHint, signatureType(params, returnType), false, false, undefined, typeParams) as unknown as FnRef<Params, Return, TypeParams>
  }
}

type CheckEarlyReturns<Yields, Declared> = [Denotes<ReturnValue<Yields>>] extends [Declared] ? unknown
  : ["early returns", Denotes<ReturnValue<Yields>>, "do not satisfy the declared return type", Declared]

/** the declared return type, or else what the returned expressions infer to */
type ImplReturn<Declared, Final, Yields> = unknown extends Declared ? WidenReturn<Lift<Final> | ReturnValue<Yields>> : Declared

export interface FnSpec<
  Params extends AnyParams = [],
  Declared = unknown,
  TypeParams extends Type.AnyParams = [],
  Yields extends NonLoopStatement = NonLoopStatement,
  Final = unknown,
> {
  readonly typeParams?: TypeParams | undefined
  readonly params?: Params | undefined
  readonly returns?: Type.Type<Declared> | undefined
  readonly body: (bindings: ParamBindings<Params>) => Generator<Yields, Final, unknown>
}

type ReturnOk<Final, Declared> =
    unknown extends Declared ? unknown
  : [Value<Final>] extends [Declared] ? unknown
  : ["the returned value", Value<Final>, "is not assignable to", Declared]

/** an error tuple fails the call; `unknown`, the success of these checks, does not */
type Fail<T> = [T] extends [unknown[]] ? T : unknown

/** the builder, or the first check that failed, so a bad spec is not yieldable */
type FnResult<Params extends AnyParams, Declared, TypeParams extends Type.AnyParams, Yields, Final> =
    CheckLift<Final> extends [] ?
      [CheckParams<Params>] extends [unknown[]] ? CheckParams<Params>
    : [Type.CheckTypeParamNames<TypeParams>] extends [unknown[]] ? Type.CheckTypeParamNames<TypeParams>
    : [CheckEarlyReturns<Yields, Declared>] extends [unknown[]] ? CheckEarlyReturns<Yields, Declared>
    : [ReturnOk<Final, Declared>] extends [unknown[]] ? ReturnOk<Final, Declared>
    : FunctionBuilder<Params, ImplReturn<Declared, Final, Yields>, TypeParams>
  : CheckLift<Final>

/** `function name(...) { body }`, configured in one step */
export const fn = <
  const Params extends AnyParams = [],
  Declared = unknown,
  const TypeParams extends Type.AnyParams = [],
  Yields extends NonLoopStatement = NonLoopStatement,
  Final = unknown,
>(
  name: string,
  spec:
    & FnSpec<Params, Declared, TypeParams, Yields, Final>
    & Fail<CheckParams<Params>>
    & Fail<Type.CheckTypeParamNames<TypeParams>>,
): FnResult<Params, NoInfer<Declared>, TypeParams, Yields, Final> =>
  // the result type is a check; the value is always the builder, and a failed check is un-yieldable
  new FunctionBuilder({
    kind: "function-declaration",
    id: freshBindingId(),
    nameHint: name,
    typeParams: spec.typeParams ?? ([] as unknown as TypeParams),
    params: (spec.params ?? []) as unknown as Params,
    returnType: spec.returns,
    impl: spec.body as never,
  } as unknown as FunctionDeclaration<Params, ImplReturn<Declared, Final, Yields>, TypeParams>) as FnResult<
    Params,
    NoInfer<Declared>,
    TypeParams,
    Yields,
    Final
  >

// type aliases

/** `type Name = body`, or `type Name<params> = body` */
export interface TypeDeclaration<Body = unknown, Params extends Type.AnyParams = []> {
  readonly kind: "type-declaration"
  readonly name: string
  readonly params: Params
  readonly body: Type.Type<Body>
}

export class TypeBuilder<Body = unknown, Params extends Type.AnyParams = []> extends Builder {
  readonly declaration: TypeDeclaration<Body, Params>

  constructor(declaration: TypeDeclaration<Body, Params>) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<TypeDeclaration<Body, Params>, Type.TypeRef<Type.Declared<Params, Body>>, unknown> {
    yield makeStatement(this.declaration)
    return Type.ref(this.declaration.name)
  }
}

/** the params of one alias, addressed by the name each declares */
export type ParamContext<Params extends Type.AnyParams> = {
  [P in Params[number] as P["name"]]: P
}

export interface TypeAlias<Body, Params extends Type.AnyParams = []> {
  readonly params: Params
  readonly body: Type.Type<Body>
}

/** a generic alias whose body is a function of its params, constraints included */
export interface TypeAliasBody<Body, Params extends Type.AnyParams = []> {
  readonly params: Params
  readonly body: (params: ParamContext<Params>) => Type.Type<Body>
}

type CheckedSpec<Params extends Type.AnyParams, Spec> =
  & Spec
  & (Type.CheckTypeParamNames<Params> extends unknown[] ? Type.CheckTypeParamNames<Params> : unknown)

type AliasSpec = TypeAlias<any, Type.AnyParams> | TypeAliasBody<any, Type.AnyParams>

const aliasBody = (name: string, params: readonly Type.AnyParam[], body: AliasSpec["body"]): Type.Type<any> => {
  if (typeof body !== "function") return body
  const ctx: { [name: string]: Type.AnyParam } = {}
  for (const param of params) ctx[param.name] = param
  const built = body(ctx)
  if (!isType(built)) throw new Error(`type "${name}" body must return a type`)
  return built
}

/** `type name = body`, or `type name<T extends ...> = body` when `params` is given */
export function type_<Body>(name: string, body: Type.Type<Body>): TypeBuilder<Body, []>
export function type_<Body, const Params extends Type.AnyParams>(
  name: string,
  spec: CheckedSpec<Params, TypeAliasBody<Body, Params>>,
): TypeBuilder<Body, Params>
export function type_<Body, const Params extends Type.AnyParams>(
  name: string,
  spec: CheckedSpec<Params, TypeAlias<Body, Params>>,
): TypeBuilder<Body, Params>
export function type_<Body>(name: string, bodyOrSpec: Type.Type<Body> | AliasSpec): TypeBuilder<Body, Type.AnyParams> {
  if (isType(bodyOrSpec)) return new TypeBuilder({ kind: "type-declaration", name, params: [], body: bodyOrSpec })
  return new TypeBuilder({
    kind: "type-declaration",
    name,
    params: bodyOrSpec.params,
    body: aliasBody(name, bodyOrSpec.params, bodyOrSpec.body),
  })
}
