/**
 * ToolExecutor handles tool resolution and execution.
 * Supports parallel execution with error handling.
 */

import { ToolRegistry, type ToolDefinition, type ToolResultEvent } from './ToolRegistry'

export interface ToolCallInput {
  toolId: string
  name: string
  args: Record<string, unknown>
  callId: string
}

export class ToolExecutor {
  constructor(private registry: ToolRegistry) {}

  /**
   * Resolve a tool by ID.
   * Throws if not found.
   */
  resolveTool(toolId: string): ToolDefinition {
    const tool = this.registry.get(toolId)
    if (!tool) {
      throw new Error(`[ToolExecutor] Tool '${toolId}' not found in registry`)
    }
    return tool
  }

  /**
   * Execute a single tool call.
   * Returns ToolResultEvent with result or error.
   */
  async executeTool(call: ToolCallInput): Promise<ToolResultEvent> {
    const startTs = Date.now()

    try {
      const tool = this.resolveTool(call.toolId)

      // Validate arguments (basic schema check)
      if (tool.parameters) {
        this.validateArguments(call.args, tool.parameters)
      }

      // Execute the tool
      const result = await tool.execute(call.args)

      const executionMs = Date.now() - startTs

      return {
        type: 'tool_result',
        toolId: call.toolId,
        name: call.name,
        callId: call.callId,
        result,
        executionMs,
      }
    } catch (error) {
      const executionMs = Date.now() - startTs

      return {
        type: 'tool_result',
        toolId: call.toolId,
        name: call.name,
        callId: call.callId,
        error: {
          code: error instanceof Error ? error.name : 'unknown_error',
          message: error instanceof Error ? error.message : String(error),
        },
        executionMs,
      }
    }
  }

  /**
   * Execute multiple tool calls in parallel.
   * Each call is independent; errors don't block others.
   */
  async executeTools(calls: ToolCallInput[]): Promise<ToolResultEvent[]> {
    const promises = calls.map(call => this.executeTool(call))
    return Promise.all(promises)
  }

  /**
   * Private: Validate tool call arguments against schema.
   */
  private validateArguments(args: Record<string, unknown>, parameters: any): void {
    if (!parameters.properties) {
      return // No schema defined, skip validation
    }

    // Check required fields
    if (parameters.required) {
      for (const requiredKey of parameters.required) {
        if (!(requiredKey in args)) {
          throw new Error(`[ToolExecutor] Missing required argument: '${requiredKey}'`)
        }
      }
    }

    // Check for unexpected fields
    for (const key in args) {
      if (!(key in parameters.properties)) {
        console.warn(`[ToolExecutor] Unexpected argument '${key}' passed to tool`)
      }
    }

    // Basic type checking (can be extended)
    for (const key in args) {
      const param = parameters.properties[key]
      if (!param) continue

      const value = args[key]
      const expectedType = param.type

      if (value === null || value === undefined) {
        continue // Allow null/undefined
      }

      const actualType = typeof value
      if (actualType !== expectedType && expectedType !== 'object') {
        throw new Error(
          `[ToolExecutor] Argument '${key}' expected ${expectedType} but got ${actualType}`
        )
      }
    }
  }
}
