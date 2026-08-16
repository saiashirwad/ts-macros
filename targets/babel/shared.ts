import * as t from "@babel/types"

export const ident = (name: string, context: string): t.Identifier => {
  if (!t.isValidIdentifier(name)) {
    throw new Error(`Cannot emit invalid identifier "${name}" (in ${context})`)
  }
  return t.identifier(name)
}

export const assertNever = (x: never): never => {
  throw new Error(`cannot emit "${(x as { readonly tag: string }).tag}"`)
}
