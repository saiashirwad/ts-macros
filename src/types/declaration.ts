import { Builder, isType, makeStatement } from "../node.ts"
import type { Declared, Type } from "./core.ts"
import { type AnyParam, type AnyParams, type CheckTypeParamNames, type Param, ref, type TypeRef } from "./nodes.ts"

/** `type Name = body`, or `type Name<params> = body` */
export interface TypeDeclaration<Body = unknown, Params extends AnyParams = []> {
  readonly kind: "type-declaration"
  readonly name: string
  readonly params: Params
  readonly body: Type<Body>
}

export class TypeBuilder<Body = unknown, Params extends AnyParams = []> extends Builder {
  readonly declaration: TypeDeclaration<Body, Params>

  constructor(declaration: TypeDeclaration<Body, Params>) {
    super()
    this.declaration = declaration
  }

  *[Symbol.iterator](): Generator<TypeDeclaration<Body, Params>, TypeRef<Declared<Params, Body>>, unknown> {
    yield makeStatement(this.declaration)
    return ref(this.declaration.name)
  }
}

/** the params of one alias, addressed by the name each declares */
export type ParamContext<Params extends AnyParams> = {
  [P in Params[number] as P["name"]]: P
}

export interface TypeAlias<Body, Params extends AnyParams = []> {
  readonly params: Params
  readonly body: Type<Body>
}

/** a generic alias whose body is a function of its params, constraints included */
export interface TypeAliasBody<Body, Params extends AnyParams = []> {
  readonly params: Params
  readonly body: (params: ParamContext<Params>) => Type<Body>
}

type CheckedSpec<Params extends AnyParams, Spec> =
  & Spec
  & (CheckTypeParamNames<Params> extends unknown[] ? CheckTypeParamNames<Params> : unknown)

type AliasSpec = TypeAlias<any, AnyParams> | TypeAliasBody<any, AnyParams>

const aliasBody = (name: string, params: readonly AnyParam[], body: AliasSpec["body"]): Type<any> => {
  if (typeof body !== "function") return body
  const ctx: { [name: string]: AnyParam } = {}
  for (const param of params) ctx[param.name] = param
  const built = body(ctx)
  if (!isType(built)) throw new Error(`type "${name}" body must return a type`)
  return built
}

/** `type name = body`, or `type name<T extends ...> = body` when `params` is given */
export function type_<Body>(name: string, body: Type<Body>): TypeBuilder<Body, []>
export function type_<Body, const Params extends AnyParams>(
  name: string,
  spec: CheckedSpec<Params, TypeAliasBody<Body, Params>>,
): TypeBuilder<Body, Params>
export function type_<Body, const Params extends AnyParams>(
  name: string,
  spec: CheckedSpec<Params, TypeAlias<Body, Params>>,
): TypeBuilder<Body, Params>
export function type_<Body>(name: string, bodyOrSpec: Type<Body> | AliasSpec): TypeBuilder<Body, AnyParams> {
  if (isType(bodyOrSpec)) return new TypeBuilder({ kind: "type-declaration", name, params: [], body: bodyOrSpec })
  return new TypeBuilder({
    kind: "type-declaration",
    name,
    params: bodyOrSpec.params,
    body: aliasBody(name, bodyOrSpec.params, bodyOrSpec.body),
  })
}

export type { Param }
