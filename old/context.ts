import type { TSTypeDescriptor } from "./ir"

export type BuildContext = {
  typeAliases: Map<string, TSTypeDescriptor>
  classes: Map<string, TSTypeDescriptor>
}

export const createBuildContext = (): BuildContext => ({
  typeAliases: new Map<string, TSTypeDescriptor>(),
  classes: new Map<string, TSTypeDescriptor>(),
})

export const defaultBuildContext = createBuildContext()

let activeBuildContext = defaultBuildContext

export const getActiveBuildContext = (): BuildContext => activeBuildContext

export const withBuildContext = <T>(buildContext: BuildContext, run: () => T): T => {
  const previous = activeBuildContext
  activeBuildContext = buildContext
  try {
    return run()
  } finally {
    activeBuildContext = previous
  }
}

export const typeAliasRegistry = defaultBuildContext.typeAliases
export const classRegistry = defaultBuildContext.classes

export const registerTypeAlias = (
  name: string,
  descriptor: TSTypeDescriptor,
  buildContext: BuildContext = getActiveBuildContext(),
): void => {
  buildContext.typeAliases.set(name, descriptor)
  if (buildContext !== defaultBuildContext) {
    typeAliasRegistry.set(name, descriptor)
  }
}

export const registerClass = (
  name: string,
  descriptor: TSTypeDescriptor,
  buildContext: BuildContext = getActiveBuildContext(),
): void => {
  buildContext.classes.set(name, descriptor)
  if (buildContext !== defaultBuildContext) {
    classRegistry.set(name, descriptor)
  }
}

export const lookupTypeAlias = (
  name: string,
  buildContext: BuildContext = getActiveBuildContext(),
): TSTypeDescriptor | undefined => buildContext.typeAliases.get(name) ?? typeAliasRegistry.get(name)

export const lookupClass = (
  name: string,
  buildContext: BuildContext = getActiveBuildContext(),
): TSTypeDescriptor | undefined => buildContext.classes.get(name) ?? classRegistry.get(name)
