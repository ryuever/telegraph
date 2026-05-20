import type { PermissionRequest } from '@/packages/agent-protocol'

export type HarnessExtensionSourceKind = 'builtin' | 'user' | 'workspace' | 'run'

export type ActivationEvent =
  | `onAgentRun:${string}`
  | `onAgent:${string}`
  | `onTool:${string}`
  | `onContext:${string}`
  | `onPagelet:${string}`
  | `onCommand:${string}`

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

  if (manifest.contributes?.agents) {
    for (const [index, agent] of manifest.contributes.agents.entries()) {
      assertString(agent.id, `contributes.agents[${index}].id`)
      assertString(agent.title, `contributes.agents[${index}].title`)
      assertString(agent.description, `contributes.agents[${index}].description`)
      assertString(agent.prompt, `contributes.agents[${index}].prompt`)
    }
  }

  return manifest as HarnessExtensionManifest
}

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Harness extension manifest missing required string field: ${field}`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
