export interface ResourcesDiscoverEvent {
  type: 'resources_discover'
  cwd: string
  reason: 'startup' | 'reload' | 'run'
}

export interface ResourcesDiscoverResult {
  skillPaths?: string[]
  contextFilePaths?: string[]
  systemPromptPaths?: string[]
  appendSystemPromptPaths?: string[]
}

export type ResourcesDiscoverHandler = (
  event: ResourcesDiscoverEvent,
) => ResourcesDiscoverResult | void | Promise<ResourcesDiscoverResult | void>
