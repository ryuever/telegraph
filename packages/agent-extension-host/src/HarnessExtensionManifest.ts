import type { PermissionRequest } from '@/packages/agent-protocol'

export type HarnessExtensionSourceKind = 'builtin' | 'user' | 'workspace' | 'run'

export type ActivationEvent =
  | `onAgentRun:${string}`
  | `onAgent:${string}`
  | `onTool:${string}`
  | `onContext:${string}`
  | `onPagelet:${string}`
  | `onCommand:${string}`
  | 'onResourcesDiscover'

export interface HarnessExtensionManifest {
  id: string
  displayName: string
  version: string
  engines?: { telegraph?: string }
  pagelets?: string[]
  activationEvents?: ActivationEvent[]
  contributes?: HarnessContributions
  permissions?: PermissionRequest[]
  main?: string
}

export interface HarnessContributions {
  agents?: AgentContribution[]
  tools?: ToolContribution[]
  orchestrationTools?: OrchestrationToolContribution[]
  contextProviders?: ContextProviderContribution[]
  resources?: ResourceContribution[]
  hooks?: HookContribution[]
  runners?: RunnerContribution[]
  commands?: CommandContribution[]
  traceRenderers?: TraceRendererContribution[]
}

export interface AgentContribution {
  id: string
  title: string
  description: string
  prompt: string
  tools?: string[]
  runner?: string
  defaultContext?: string[]
  replaces?: string
  metadata?: Record<string, unknown>
}

export interface ToolContribution {
  id: string
  title: string
  description: string
  scope?: string
  metadata?: Record<string, unknown>
}

export interface OrchestrationToolContribution extends ToolContribution {
  agentSource?: 'enabled-registry'
}

export interface ContextProviderContribution {
  id: string
  description: string
  activation?: ActivationEvent
  metadata?: Record<string, unknown>
}

export type ResourceContributionKind =
  | 'skill'
  | 'prompt'
  | 'context-file'
  | 'system-prompt'
  | 'append-system-prompt'
  | 'theme'
  | 'custom'

export interface ResourceContribution {
  id: string
  kind: ResourceContributionKind
  path: string
  description?: string
  metadata?: Record<string, unknown>
}

export interface HookContribution {
  id: string
  hook: string
  description?: string
}

export interface RunnerContribution {
  id: string
  title: string
  description?: string
}

export interface CommandContribution {
  id: string
  title: string
  description?: string
}

export interface TraceRendererContribution {
  id: string
  eventType: string
  title: string
}

export interface HarnessExtensionPackage {
  manifest: HarnessExtensionManifest
  rootPath?: string
  manifestPath?: string
  mainPath?: string
  sourceKind: HarnessExtensionSourceKind
}

export function parseHarnessExtensionManifest(raw: unknown): HarnessExtensionManifest {
  if (!isRecord(raw)) {
    throw new Error('Harness extension manifest must be an object')
  }

  const manifest = raw as Partial<HarnessExtensionManifest>
  assertString(manifest.id, 'id')
  assertString(manifest.displayName, 'displayName')
  assertString(manifest.version, 'version')

  for (const [index, agent] of (manifest.contributes?.agents ?? []).entries()) {
    assertString(agent.id, `contributes.agents[${String(index)}].id`)
    assertString(agent.title, `contributes.agents[${String(index)}].title`)
    assertString(agent.description, `contributes.agents[${String(index)}].description`)
    assertString(agent.prompt, `contributes.agents[${String(index)}].prompt`)
  }

  for (const [index, resource] of (manifest.contributes?.resources ?? []).entries()) {
    assertString(resource.id, `contributes.resources[${String(index)}].id`)
    assertResourceKind(resource.kind, `contributes.resources[${String(index)}].kind`)
    assertString(resource.path, `contributes.resources[${String(index)}].path`)
  }

  return manifest as HarnessExtensionManifest
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Harness extension manifest missing required string field: ${field}`)
  }
}

function assertResourceKind(value: unknown, field: string): asserts value is ResourceContributionKind {
  if (
    value !== 'skill' &&
    value !== 'prompt' &&
    value !== 'context-file' &&
    value !== 'system-prompt' &&
    value !== 'append-system-prompt' &&
    value !== 'theme' &&
    value !== 'custom'
  ) {
    throw new Error(`Harness extension manifest has invalid resource kind: ${field}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
