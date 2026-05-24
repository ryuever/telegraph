export type ComponentEditSource =
  | 'preview-dom'
  | 'patch-operation'
  | 'preview-placeholder'
  | 'style-editor'
  | 'inspector'
  | 'code-editor'

export type ComponentEditScope = 'composition' | 'primitive-source' | 'unknown'

export interface ComponentEditSourceLocation {
  filePath: string
  line: number
  column: number
}

export interface ComponentEditTargetSnapshot {
  id: string
  artifactId: string
  label: string
  source: ComponentEditSource
  path?: string
  operationKind?: 'add' | 'update' | 'delete'
  elementTag?: string
  className?: string
  attributes?: Record<string, string>
  sourceLocation?: ComponentEditSourceLocation
}

export interface ComponentEditDirtyOperation {
  path: string
  kind: 'add' | 'update' | 'delete'
  source: ComponentEditSource
  contentPreview?: string
  contentLength?: number
  expectedOriginalLength?: number
}

export interface ComponentEditBinding {
  sourcePath?: string
  sourceLocation?: ComponentEditSourceLocation
  editScope: ComponentEditScope
  preferredOperationPath?: string
  protectedPrimitivePaths: string[]
  provenance: 'shadcn-primitive' | 'composition' | 'unknown'
}

export interface ComponentEditContext {
  kind: 'component-edit'
  artifactId: string
  parentArtifactId?: string
  revision?: number
  prompt?: string
  target?: ComponentEditTargetSnapshot
  binding: ComponentEditBinding
  dirtyOperations: ComponentEditDirtyOperation[]
  dirtyOperationPaths: string[]
}

export interface CreateComponentEditContextInput {
  artifactId: string
  parentArtifactId?: string
  revision?: number
  prompt?: string
  target?: ComponentEditTargetSnapshot | null
  artifactOperationPaths?: string[]
  dirtyOperations?: ComponentEditDirtyOperation[]
}

const SHADCN_PRIMITIVE_PATH = /(^|\/)src\/components\/ui\/[^/]+\.(tsx|ts|jsx|js)$/
const COMPOSITION_SOURCE_PATH = /(^|\/)src\/(App|app|pages?|routes?|features?|components)\/?.*\.(tsx|jsx)$|(^|\/)src\/(App|app|main|index)\.(tsx|jsx)$/

export function createComponentEditContext(input: CreateComponentEditContextInput): ComponentEditContext {
  const dirtyOperations = input.dirtyOperations ?? []
  const artifactOperationPaths = input.artifactOperationPaths ?? []
  const sourcePath = input.target?.sourceLocation?.filePath ?? input.target?.path
  const protectedPrimitivePaths = uniqueStrings([
    ...artifactOperationPaths.filter(isShadcnPrimitivePath),
    ...dirtyOperations.map(operation => operation.path).filter(isShadcnPrimitivePath),
    sourcePath && isShadcnPrimitivePath(sourcePath) ? sourcePath : undefined,
  ])
  const preferredOperationPath = preferredCompositionPath({
    sourcePath,
    dirtyOperationPaths: dirtyOperations.map(operation => operation.path),
    artifactOperationPaths,
  })
  const sourceIsPrimitive = Boolean(sourcePath && isShadcnPrimitivePath(sourcePath))

  return {
    kind: 'component-edit',
    artifactId: input.artifactId,
    parentArtifactId: input.parentArtifactId,
    revision: input.revision,
    prompt: input.prompt,
    target: input.target ?? undefined,
    binding: {
      sourcePath,
      sourceLocation: input.target?.sourceLocation,
      editScope: sourceIsPrimitive
        ? 'composition'
        : preferredOperationPath ? 'composition' : 'unknown',
      preferredOperationPath,
      protectedPrimitivePaths,
      provenance: sourceIsPrimitive
        ? 'shadcn-primitive'
        : sourcePath ? 'composition' : 'unknown',
    },
    dirtyOperations,
    dirtyOperationPaths: dirtyOperations.map(operation => operation.path),
  }
}

export function isComponentEditContext(value: unknown): value is ComponentEditContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<ComponentEditContext>
  return record.kind === 'component-edit' &&
    typeof record.artifactId === 'string' &&
    Boolean(record.binding) &&
    typeof record.binding === 'object' &&
    !Array.isArray(record.binding) &&
    Array.isArray(record.dirtyOperations) &&
    Array.isArray(record.dirtyOperationPaths)
}

export function isShadcnPrimitivePath(path: string): boolean {
  return SHADCN_PRIMITIVE_PATH.test(path.replace(/\\/g, '/'))
}

function preferredCompositionPath(input: {
  sourcePath?: string
  dirtyOperationPaths: string[]
  artifactOperationPaths: string[]
}): string | undefined {
  const candidates = [
    input.sourcePath,
    ...input.dirtyOperationPaths,
    ...input.artifactOperationPaths,
  ].filter((path): path is string => Boolean(path))
  return candidates.find(path => !isShadcnPrimitivePath(path) && looksLikeCompositionPath(path)) ??
    candidates.find(path => !isShadcnPrimitivePath(path))
}

function looksLikeCompositionPath(path: string): boolean {
  return COMPOSITION_SOURCE_PATH.test(path.replace(/\\/g, '/'))
}

function uniqueStrings(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
}
