import type { RuntimeEvent } from './events.js'
import type { PermissionRequest } from './permissions.js'

export interface ToolExample {
  input: unknown
  output?: unknown
  description?: string
}

/**
 * Serializable tool registration metadata.
 * Execution lives in runtime adapters (`execute` is intentionally not part of this contract).
 */
export interface ToolDefinition {
  name: string
  title?: string
  description: string
  inputSchema: unknown
  outputSchema?: unknown
  permissions?: PermissionRequest[]
  examples?: ToolExample[]
  metadata?: {
    provider?: 'pi' | 'mcp' | 'telegraph' | 'custom'
    sourceExtensionId?: string
    raw?: unknown
  }
}

export interface ToolExecutionContext {
  runId: string
  sessionId: string
  workspaceRoot?: string
  emit(event: RuntimeEvent): void | Promise<void>
  readResource?(uri: string): Promise<unknown>
  requestPermission?(permission: PermissionRequest): Promise<boolean>
}

export interface ToolResult {
  content: unknown
  display?: unknown
  raw?: unknown
}
