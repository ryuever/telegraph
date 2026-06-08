import { dirname } from 'node:path'
import type { ResolvedResourceContribution } from '@/packages/agent-extensions'
import type {
  ResourceExtensionPaths,
  ResourcePathEntry,
  ResourcePathMetadata,
} from './resource-loader'

export type AutoMaterializedResourceContributionKind =
  | 'skill'
  | 'context-file'
  | 'system-prompt'
  | 'append-system-prompt'

export interface ResourceContributionPathProjection {
  paths: ResourceExtensionPaths
  ignored: ResolvedResourceContribution[]
}

export function resourceExtensionPathsFromContributions(
  resources: ResolvedResourceContribution[],
): ResourceExtensionPaths {
  return projectResourceContributionsToExtensionPaths(resources).paths
}

export function projectResourceContributionsToExtensionPaths(
  resources: ResolvedResourceContribution[],
): ResourceContributionPathProjection {
  const paths: ResourceExtensionPaths = {}
  const ignored: ResolvedResourceContribution[] = []

  for (const resource of resources) {
    const entry = entryFromResourceContribution(resource)
    if (!entry) {
      ignored.push(resource)
      continue
    }

    if (resource.kind === 'skill') {
      paths.skillPaths = [...(paths.skillPaths ?? []), entry]
      continue
    }
    if (resource.kind === 'context-file') {
      paths.contextFilePaths = [...(paths.contextFilePaths ?? []), entry]
      continue
    }
    if (resource.kind === 'system-prompt') {
      paths.systemPromptPaths = [...(paths.systemPromptPaths ?? []), entry]
      continue
    }
    if (resource.kind === 'append-system-prompt') {
      paths.appendSystemPromptPaths = [...(paths.appendSystemPromptPaths ?? []), entry]
      continue
    }

    ignored.push(resource)
  }

  return { paths, ignored }
}

function entryFromResourceContribution(
  resource: ResolvedResourceContribution,
): ResourcePathEntry | undefined {
  const sourcePath = resource.sourcePath ?? resource.path
  if (!sourcePath || isUri(sourcePath)) return undefined

  return {
    path: resource.kind === 'skill' ? skillRootPath(sourcePath) : sourcePath,
    metadata: metadataFromResourceContribution(resource),
  }
}

function metadataFromResourceContribution(
  resource: ResolvedResourceContribution,
): ResourcePathMetadata {
  return {
    sourceKind: 'extension',
    extensionId: resource.origin.extensionId,
    contributionId: resource.origin.contributionId,
    baseDir: resource.origin.rootPath,
    origin: resource.fullId,
  }
}

function skillRootPath(path: string): string {
  return /(^|[/\\])SKILL\.md$/i.test(path) ? dirname(path) : path
}

function isUri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value)
}
