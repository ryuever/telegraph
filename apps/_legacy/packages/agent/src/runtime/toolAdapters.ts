import type { ToolDefinition } from '@telegraph/runtime-contracts'

/** Map a pi-ai / OpenAI-style tool descriptor into a serializable `ToolDefinition`. */
export function piAiToolLikeToDefinition(tool: {
  name: string
  description?: string
  parameters?: unknown
  inputSchema?: unknown
}): ToolDefinition {
  return {
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? tool.parameters ?? {},
    metadata: { provider: 'pi' },
  }
}

/** Map a generic JSON-schema tool (e.g. MCP) into `ToolDefinition`. */
export function jsonSchemaToolToDefinition(
  name: string,
  description: string,
  schema: unknown,
  metadata?: ToolDefinition['metadata']
): ToolDefinition {
  return {
    name,
    description,
    inputSchema: schema ?? {},
    metadata: metadata ?? { provider: 'custom' },
  }
}
