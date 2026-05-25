export const GENERATED_REACT_VERSION = '19.1.0'

export function mergeGeneratedPackageJsonContent(
  existingContent: string | undefined,
  incomingContent: string | undefined,
): string | undefined {
  if (!incomingContent) return normalizeGeneratedPackageJsonContent(existingContent)
  const incomingJson = parseRecord(incomingContent)
  if (!incomingJson) return incomingContent

  const existingJson = parseRecord(existingContent)
  if (!existingJson) return JSON.stringify(normalizeGeneratedPackageJsonRecord(incomingJson), null, 2)

  return JSON.stringify(normalizeGeneratedPackageJsonRecord({
    ...existingJson,
    ...incomingJson,
    dependencies: {
      ...recordField(existingJson, 'dependencies'),
      ...recordField(incomingJson, 'dependencies'),
    },
    devDependencies: {
      ...recordField(existingJson, 'devDependencies'),
      ...recordField(incomingJson, 'devDependencies'),
    },
  }), null, 2)
}

export function normalizeGeneratedPackageJsonContent(content: string | undefined): string | undefined {
  const parsed = parseRecord(content)
  return parsed ? JSON.stringify(normalizeGeneratedPackageJsonRecord(parsed), null, 2) : content
}

function normalizeGeneratedPackageJsonRecord(value: Record<string, unknown>): Record<string, unknown> {
  const dependencies = recordField(value, 'dependencies')
  if (Object.keys(dependencies).length === 0) return value
  return {
    ...value,
    dependencies: normalizeReactRuntimeDependencies(dependencies),
  }
}

function normalizeReactRuntimeDependencies(dependencies: Record<string, unknown>): Record<string, unknown> {
  if (!hasOwn(dependencies, 'react') && !hasOwn(dependencies, 'react-dom')) return dependencies
  return {
    ...dependencies,
    react: GENERATED_REACT_VERSION,
    'react-dom': GENERATED_REACT_VERSION,
  }
}

function parseRecord(content: string | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  try {
    const value = JSON.parse(content) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const field = value[key]
  return isRecord(field) ? field : {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}
