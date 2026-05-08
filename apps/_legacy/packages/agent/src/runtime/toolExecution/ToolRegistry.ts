/**
 * ToolRegistry manages tool definitions and resolution.
 * Tools can come from built-in, extensions, or user-defined sources.
 */

export interface ToolParameter {
  type: string // 'string', 'number', 'boolean', 'object', 'array'
  description?: string
  enum?: unknown[]
  default?: unknown
}

export interface ToolParameters {
  type: 'object'
  properties: Record<string, ToolParameter>
  required?: string[]
}

export interface ToolDefinition {
  id: string // Unique identifier (e.g., 'weather_tool')
  name: string // Display name
  description?: string
  parameters?: ToolParameters
  execute: (args: Record<string, unknown>) => Promise<unknown>
  // Optional metadata
  source?: 'builtin' | 'extension' | 'user'
  version?: string
  sourceUrl?: string // e.g., 'extension://weather-tools/weather_tool'
}

export interface ToolCallEvent {
  type: 'tool_call'
  toolId: string
  name: string
  args: Record<string, unknown>
  callId: string // Unique per tool call
}

export interface ToolResultEvent {
  type: 'tool_result'
  toolId: string
  name: string
  callId: string // Back-reference to tool_call
  result?: unknown
  error?: {
    code: string
    message: string
  }
  executionMs: number
}

/**
 * In-memory tool registry.
 * Maps tool IDs to tool definitions for resolution and execution.
 */
export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()
  private idToName = new Map<string, string>() // Quick lookup: id -> name

  /**
   * Register a tool.
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.id)) {
      throw new Error(`[ToolRegistry] Tool '${tool.id}' already registered`)
    }

    this.tools.set(tool.id, tool)
    this.idToName.set(tool.id, tool.name)
  }

  /**
   * Unregister a tool.
   */
  unregister(toolId: string): boolean {
    const existed = this.tools.delete(toolId)
    if (existed) {
      this.idToName.delete(toolId)
    }
    return existed
  }

  /**
   * Get a tool by ID.
   */
  get(toolId: string): ToolDefinition | undefined {
    return this.tools.get(toolId)
  }

  /**
   * Get a tool by name.
   */
  getByName(name: string): ToolDefinition | undefined {
    for (const tool of this.tools.values()) {
      if (tool.name === name) {
        return tool
      }
    }
    return undefined
  }

  /**
   * List all registered tools.
   */
  list(): ToolDefinition[] {
    return Array.from(this.tools.values())
  }

  /**
   * List available tool IDs.
   */
  listIds(): string[] {
    return Array.from(this.tools.keys())
  }

  /**
   * Check if a tool is registered.
   */
  has(toolId: string): boolean {
    return this.tools.has(toolId)
  }

  /**
   * Get registry statistics.
   */
  getStats() {
    const tools = Array.from(this.tools.values())
    return {
      totalTools: tools.length,
      builtinTools: tools.filter(t => t.source === 'builtin').length,
      extensionTools: tools.filter(t => t.source === 'extension').length,
      userTools: tools.filter(t => t.source === 'user').length,
      tools: tools.map(t => ({
        id: t.id,
        name: t.name,
        source: t.source ?? 'unknown',
        version: t.version,
      })),
    }
  }

  /**
   * Clear all tools.
   */
  clear(): void {
    this.tools.clear()
    this.idToName.clear()
  }
}
