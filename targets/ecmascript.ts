// What the ECMAScript-syntax targets must agree on, so that one program means
// the same thing through either of them.

import type * as Type from "../src/types/index.ts"

const NAME = /^[\p{ID_Start}$_][\p{ID_Continue}$‌‍]*$/u

// reserved in a module, which is always strict
const RESERVED: ReadonlySet<string> = new Set(
  (
    "await break case catch class const continue debugger default delete do else enum export extends false finally for function if "
    + "implements import in instanceof interface let new null package private protected public return static super switch this throw "
    + "true try typeof var void while with yield"
  ).split(" "),
)

/** a name in binding position: a variable, function, param, import, or type */
export const identifier = (name: string, context: string): string => {
  if (!NAME.test(name) || RESERVED.has(name)) throw new Error(`cannot emit invalid identifier "${name}" (in ${context})`)
  return name
}

/** a name after `.` or before `:`, where a reserved word is fine (`module.default`) */
export const propertyName = (name: string, context: string): string => {
  if (!NAME.test(name)) throw new Error(`cannot emit invalid property name "${name}" (in ${context})`)
  return name
}

/** the source text of a template part; parts hold the string the template produces, as `Expr.String` does */
export const templateRaw = (part: string): string => part.replace(/\\|`|\$\{/g, (match) => `\\${match}`)

export interface Field {
  readonly readonly: boolean
  readonly optional: boolean
  readonly type: Type.TypeExpr<any>
}

/** an object type's field with its `Readonly`/`Optional` wrappers peeled into flags */
export const unwrapField = (field: Type.TypeExpr<any>): Field => {
  let readonly = false
  let optional = false
  let current = field as Type.Any
  while (current.tag === "readonly-field" || current.tag === "optional-field") {
    if (current.tag === "readonly-field") readonly = true
    else optional = true
    current = current.field as Type.Any
  }
  return { readonly, optional, type: current }
}

export const misplacedFieldModifier = (node: Type.ReadonlyField | Type.OptionalField): never => {
  throw new Error(`"${node.tag}" is a field modifier and only valid inside an object type`)
}
