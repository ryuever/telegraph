import type { PermissionRequest } from './permissions.js'
import type { ToolDefinition } from './tools.js'

export type ExtensionCapability = 'tools' | 'commands' | 'panels' | 'hooks' | 'runtime' | 'model-provider'

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
  hook: string
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
  }
}
