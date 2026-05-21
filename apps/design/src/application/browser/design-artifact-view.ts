import type { DesignProjectedArtifact } from './design-agent-projector'
import type { DesignPatchFileOperation } from '@/apps/design/application/common'

export type DesignArtifactViewKind = 'html' | 'code' | 'json' | 'patch'

export interface DesignArtifactViewModel {
  title: string
  kind: string
  viewKind: DesignArtifactViewKind
  previewHtml?: string
  code: string
  patchSummary?: {
    adds: number
    updates: number
    deletes: number
  }
}

export function createDesignArtifactViewModel(
  artifact: DesignProjectedArtifact,
): DesignArtifactViewModel {
  const output = artifact.output
  const title = artifact.title ?? firstStringField(output, ['title', 'name']) ?? artifact.id
  const code = firstStringField(output, ['code', 'source', 'tsx', 'jsx', 'html', 'content'])
  const operations = extractDesignPatchOperations(artifact)

  if (operations) {
    return {
      title,
      kind: artifact.kind,
      viewKind: 'patch',
      code: formatPatchSource(operations),
      patchSummary: summarizeOperations(operations),
    }
  }

  if (code && looksLikeHtml(code)) {
    return {
      title,
      kind: artifact.kind,
      viewKind: 'html',
      previewHtml: code,
      code,
    }
  }

  if (code) {
    return {
      title,
      kind: artifact.kind,
      viewKind: 'code',
      code,
    }
  }

  return {
    title,
    kind: artifact.kind,
    viewKind: 'json',
    code: JSON.stringify(output, null, 2),
  }
}

export function extractDesignPatchOperations(
  artifact: DesignProjectedArtifact,
): DesignPatchFileOperation[] | null {
  const operations = arrayField(artifact.output, 'operations')
  if (!operations) return null
  const patchOperations: DesignPatchFileOperation[] = []
  for (const operation of operations) {
    const patchOperation = toPatchOperation(operation)
    if (!patchOperation) return null
    patchOperations.push(patchOperation)
  }
  return patchOperations
}

function firstStringField(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) return undefined
  for (const key of keys) {
    const item = value[key]
    if (typeof item === 'string' && item.trim().length > 0) return item
  }
  return undefined
}

function toPatchOperation(value: unknown): DesignPatchFileOperation | null {
  if (!isRecord(value)) return null
  const kind = operationKind(value)
  const path = value.path
  if ((kind !== 'add' && kind !== 'update' && kind !== 'delete') || typeof path !== 'string') {
    return null
  }

  const operation: DesignPatchFileOperation = { kind, path }
  if (typeof value.content === 'string') operation.content = value.content
  if (typeof value.expectedOriginal === 'string') operation.expectedOriginal = value.expectedOriginal
  return operation
}

function arrayField(value: unknown, key: string): unknown[] | undefined {
  if (!isRecord(value)) return undefined
  const item = value[key]
  return Array.isArray(item) ? item : undefined
}

function summarizeOperations(operations: unknown[]): DesignArtifactViewModel['patchSummary'] {
  return {
    adds: operations.filter(operation => operationKind(operation) === 'add').length,
    updates: operations.filter(operation => operationKind(operation) === 'update').length,
    deletes: operations.filter(operation => operationKind(operation) === 'delete').length,
  }
}

function formatPatchSource(operations: DesignPatchFileOperation[]): string {
  return operations.map(operation => {
    const header = `// ${operation.kind.toUpperCase()} ${operation.path}`
    if (operation.kind === 'delete') return header
    if (!operation.content) return `${header}\n// No source content provided.`
    return `${header}\n${operation.content}`
  }).join('\n\n')
}

function operationKind(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const kind = value.kind
  return typeof kind === 'string' ? kind : undefined
}

function looksLikeHtml(value: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
