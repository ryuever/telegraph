/**
 * Resource discovery event contract emitted by the contribution registry
 * during extension activation / pagelet startup. Extensions can subscribe
 * to inject ad-hoc skill / context / system-prompt paths discovered at
 * runtime (e.g. project-local agents).
 *
 * Migrated from `@/packages/agent-extension-host` as part of D-016 P6
 * alongside the rest of the declarative contribution infrastructure.
 */
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
