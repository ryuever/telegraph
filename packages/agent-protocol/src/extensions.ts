import type { PermissionRequest } from './permissions.js'
import type { ToolDefinition } from './tools.js'
import type { HookName } from './hooks.js'
import type { SubagentProfileContribution } from './subagents.js'

export type ExtensionCapability =
  | 'tools'
  | 'commands'
  | 'panels'
  | 'hooks'
  | 'runtime'
  | 'model-provider'
  | 'subagents'
  | 'context-providers'
  | 'message-renderers'

export interface ExtensionSource {
  kind: 'marketplace' | 'local' | 'git' | 'custom'
  url?: string
  integrity?: string
}

export interface ToolContribution {
  id: string
  tool: ToolDefinition
}

/** Placeholder contributions — expanded in Phase 2+. */
export interface CommandContribution {
  id: string
  title: string
  command: string
}

export interface PanelContribution {
  id: string
  title: string
}

export interface RuntimeContribution {
  id: string
  runtimeId: string
}

export interface HookContribution {
  id: string
  hook: HookName
}

/**
 * Injects host/parent-conversation context as a prefix into a subagent's
 * input. Implementation lives extension-side; the protocol only describes
 * the contribution shape.
 */
export interface ContextProviderContribution {
  id: string
  /** Stable name an extension references via `SubagentProfile.contextProvider`. */
  name: string
  description?: string
}

/**
 * UI-side renderer contribution. The protocol intentionally keeps this as a
 * descriptor only — actual React component wiring crosses the renderer
 * boundary and is resolved in the renderer process (D-016 §9 Q1).
 */
export interface MessageRendererContribution {
  id: string
  /** Matcher to select messages this renderer handles, e.g. `tool:explore.*` */
  match: string
  /** Stable component id; renderer-side registry maps id → React component. */
  componentId: string
}

export interface ExtensionManifest {
  id: string
  name: string
  version: string
  description?: string
  source?: ExtensionSource
  entry: string
  capabilities: ExtensionCapability[]
  permissions: PermissionRequest[]
  contributes?: {
    tools?: ToolContribution[]
    commands?: CommandContribution[]
    panels?: PanelContribution[]
    runtimes?: RuntimeContribution[]
    hooks?: HookContribution[]
    subagents?: SubagentProfileContribution[]
    contextProviders?: ContextProviderContribution[]
    messageRenderers?: MessageRendererContribution[]
  }
}
