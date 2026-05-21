export const builtinModules: string[] = []

export function createRequire(): () => Record<string, never> {
  return () => ({})
}

export default {}
