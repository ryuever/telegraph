/**
 * PermissionValidator for Tool Execution (Phase 3.4)
 *
 * Validates whether a tool execution request is permitted based on:
 * - Tool allowlist/blocklist
 * - User/session permissions
 * - Runtime security policies
 * - Parameter constraints
 */

/**
 * Permission level for a tool.
 */
export type PermissionLevel = 'deny' | 'allow' | 'prompt'

/**
 * Permission policy for a tool.
 */
export interface ToolPermissionPolicy {
  toolId: string
  permission: PermissionLevel
  requiresApproval?: boolean // If true, tool execution requires user approval
  maxExecutionsPerSession?: number // Limit executions in a session
  allowedParameterPatterns?: { [key: string]: RegExp } // Whitelist patterns for parameters
  deniedParameterPatterns?: { [key: string]: RegExp } // Blacklist patterns for parameters
}

/**
 * Execution context for permission checking.
 */
export interface ExecutionContext {
  toolId: string
  userId?: string
  sessionId: string
  parameters: Record<string, unknown>
  isDangerous?: boolean // Flag if tool is marked as dangerous (e.g., file deletion, code execution)
}

/**
 * Permission validation result.
 */
export interface PermissionCheckResult {
  allowed: boolean
  reason?: string
  requiresApproval?: boolean
  issues?: string[]
}

/**
 * PermissionValidator manages tool execution permissions.
 */
export class PermissionValidator {
  private policies: Map<string, ToolPermissionPolicy> = new Map()
  private sessionExecutionCounts: Map<string, Map<string, number>> = new Map() // sessionId -> toolId -> count
  private dangerousTools: Set<string> = new Set()
  private globalBlocklist: Set<string> = new Set()
  private globalAllowlist: Set<string> | null = null // null means no whitelist restriction

  /**
   * Register a permission policy for a tool.
   */
  registerPolicy(policy: ToolPermissionPolicy): void {
    this.policies.set(policy.toolId, policy)
  }

  /**
   * Register multiple policies at once.
   */
  registerPolicies(policies: ToolPermissionPolicy[]): void {
    for (const policy of policies) {
      this.registerPolicy(policy)
    }
  }

  /**
   * Mark a tool as dangerous (requires extra caution).
   * Examples: file deletion, code execution, system commands.
   */
  markDangerous(toolId: string): void {
    this.dangerousTools.add(toolId)
  }

  /**
   * Unmark a tool as dangerous.
   */
  unmarkDangerous(toolId: string): void {
    this.dangerousTools.delete(toolId)
  }

  /**
   * Check if a tool is marked as dangerous.
   */
  isDangerous(toolId: string): boolean {
    return this.dangerousTools.has(toolId)
  }

  /**
   * Add a tool to the global blocklist.
   * Blocked tools are never allowed regardless of other settings.
   */
  addToBlocklist(toolId: string): void {
    this.globalBlocklist.add(toolId)
  }

  /**
   * Remove a tool from the global blocklist.
   */
  removeFromBlocklist(toolId: string): void {
    this.globalBlocklist.delete(toolId)
  }

  /**
   * Set a global allowlist.
   * If set, only tools in the allowlist can execute.
   * Pass null to remove the allowlist restriction.
   */
  setGlobalAllowlist(toolIds: string[] | null): void {
    if (toolIds === null) {
      this.globalAllowlist = null
    } else {
      this.globalAllowlist = new Set(toolIds)
    }
  }

  /**
   * Check if execution is allowed for the given context.
   */
  checkPermission(context: ExecutionContext): PermissionCheckResult {
    const issues: string[] = []

    // Check global blocklist
    if (this.globalBlocklist.has(context.toolId)) {
      return {
        allowed: false,
        reason: 'Tool is globally blocked',
        issues: ['Tool is in global blocklist'],
      }
    }

    // Check global allowlist
    if (this.globalAllowlist !== null && !this.globalAllowlist.has(context.toolId)) {
      return {
        allowed: false,
        reason: 'Tool is not in global allowlist',
        issues: ['Tool is not in global allowlist'],
      }
    }

    // Get policy for this tool
    const policy = this.policies.get(context.toolId)

    // If no policy, check if dangerous (require approval)
    if (!policy) {
      if (this.isDangerous(context.toolId)) {
        return {
          allowed: true,
          requiresApproval: true,
          reason: 'Tool is dangerous and requires approval',
        }
      }
      // Allow by default if not dangerous
      return { allowed: true }
    }

    // Apply policy permission level
    if (policy.permission === 'deny') {
      return {
        allowed: false,
        reason: `Tool '${context.toolId}' is denied by policy`,
        issues: ['Tool execution is denied by policy'],
      }
    }

    // Check execution count limit
    if (policy.maxExecutionsPerSession) {
      const sessionCounts = this.sessionExecutionCounts.get(context.sessionId) ?? new Map()
      const executionCount = sessionCounts.get(context.toolId) ?? 0

      if (executionCount >= policy.maxExecutionsPerSession) {
        issues.push(
          `Tool execution limit (${policy.maxExecutionsPerSession}) reached in this session`
        )
      }
    }

    // Validate parameters against whitelist patterns
    if (policy.allowedParameterPatterns) {
      for (const [paramName, pattern] of Object.entries(policy.allowedParameterPatterns)) {
        const value = context.parameters[paramName]
        if (value !== undefined && value !== null) {
          const stringValue = String(value)
          if (!pattern.test(stringValue)) {
            issues.push(`Parameter '${paramName}' value '${stringValue}' does not match allowed pattern`)
          }
        }
      }
    }

    // Validate parameters against blacklist patterns
    if (policy.deniedParameterPatterns) {
      for (const [paramName, pattern] of Object.entries(policy.deniedParameterPatterns)) {
        const value = context.parameters[paramName]
        if (value !== undefined && value !== null) {
          const stringValue = String(value)
          if (pattern.test(stringValue)) {
            issues.push(`Parameter '${paramName}' value '${stringValue}' matches denied pattern`)
          }
        }
      }
    }

    // If there are validation issues, deny
    if (issues.length > 0) {
      return {
        allowed: false,
        reason: 'Parameter validation failed',
        issues,
      }
    }

    // Check if approval is required
    const requiresApproval =
      policy.permission === 'prompt' || (context.isDangerous && policy.requiresApproval)

    return {
      allowed: true,
      requiresApproval,
    }
  }

  /**
   * Record a tool execution in a session for counting purposes.
   */
  recordExecution(sessionId: string, toolId: string): void {
    if (!this.sessionExecutionCounts.has(sessionId)) {
      this.sessionExecutionCounts.set(sessionId, new Map())
    }

    const toolCounts = this.sessionExecutionCounts.get(sessionId)!
    const currentCount = toolCounts.get(toolId) ?? 0
    toolCounts.set(toolId, currentCount + 1)
  }

  /**
   * Get execution count for a tool in a session.
   */
  getExecutionCount(sessionId: string, toolId: string): number {
    return this.sessionExecutionCounts.get(sessionId)?.get(toolId) ?? 0
  }

  /**
   * Clear execution counts for a session.
   */
  clearSessionCounts(sessionId: string): void {
    this.sessionExecutionCounts.delete(sessionId)
  }

  /**
   * Clear all execution counts.
   */
  clearAllCounts(): void {
    this.sessionExecutionCounts.clear()
  }

  /**
   * Get all policies.
   */
  getPolicies(): ToolPermissionPolicy[] {
    return Array.from(this.policies.values())
  }

  /**
   * Remove a policy.
   */
  removePolicy(toolId: string): void {
    this.policies.delete(toolId)
  }

  /**
   * Get statistics about permissions.
   */
  getStats(): {
    totalPolicies: number
    blocklistedTools: number
    allowlistedTools: number | null // null if no allowlist
    dangerousTools: number
    activeSessions: number
  } {
    return {
      totalPolicies: this.policies.size,
      blocklistedTools: this.globalBlocklist.size,
      allowlistedTools: this.globalAllowlist?.size ?? null,
      dangerousTools: this.dangerousTools.size,
      activeSessions: this.sessionExecutionCounts.size,
    }
  }

  /**
   * Clear all permissions and configurations.
   */
  clear(): void {
    this.policies.clear()
    this.dangerousTools.clear()
    this.globalBlocklist.clear()
    this.globalAllowlist = null
    this.sessionExecutionCounts.clear()
  }
}
