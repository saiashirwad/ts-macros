import * as t from "@babel/types";

export function assertNever(value: never, context: string): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}

export function identifierFromName(
  name: string,
  context: string,
): t.Identifier {
  if (!t.isValidIdentifier(name)) {
    throw new Error(`${context} must be a valid identifier: ${name}`);
  }
  return t.identifier(name);
}

export function buildTypeParameters(
  typeParams?: string[],
): t.TSTypeParameterDeclaration | null {
  return typeParams?.length
    ? t.tsTypeParameterDeclaration(
        typeParams.map((param) => t.tsTypeParameter(null, null, param)),
      )
    : null;
}
