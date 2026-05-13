/**
 * DependencyGraph for Tool Coordination (Phase 3.4)
 *
 * Manages tool dependencies and provides topological sorting for execution order.
 * Detects circular dependencies and ensures safe parallel/sequential execution.
 *
 * Kahn's algorithm is used for topological sort (O(V + E) complexity).
 */

/**
 * Represents a dependency edge from one tool to another.
 * A → B means A must complete before B can execute.
 */
export interface ToolDependency {
  fromToolId: string // Tool that must complete first
  toToolId: string // Tool that depends on the completion
  isSoft?: boolean // If true, failure in fromTool doesn't block toTool
}

/**
 * Represents a node in the dependency graph.
 */
interface GraphNode {
  toolId: string
  inDegree: number
  outgoing: Set<string> // Tool IDs that depend on this tool
}

/**
 * Result of topological sort operation.
 */
export interface TopoSortResult {
  success: boolean
  order: string[][] // Groups of tools that can execute in parallel
  circularDeps?: string[] // Tool IDs involved in circular dependency (if found)
  error?: string
}

/**
 * DependencyGraph manages tool execution order and dependency constraints.
 */
export class DependencyGraph {
  private nodes: Map<string, GraphNode> = new Map()
  private edges: ToolDependency[] = []

  /**
   * Add a tool to the graph.
   */
  addTool(toolId: string): void {
    if (!this.nodes.has(toolId)) {
      this.nodes.set(toolId, {
        toolId,
        inDegree: 0,
        outgoing: new Set(),
      })
    }
  }

  /**
   * Add a dependency: fromTool must complete before toTool.
   * Throws if either tool is not registered.
   */
  addDependency(fromToolId: string, toToolId: string, isSoft = false): void {
    if (!this.nodes.has(fromToolId)) {
      throw new Error(`[DependencyGraph] Tool '${fromToolId}' not registered`)
    }
    if (!this.nodes.has(toToolId)) {
      throw new Error(`[DependencyGraph] Tool '${toToolId}' not registered`)
    }

    // Avoid duplicate edges
    const exists = this.edges.some((e) => e.fromToolId === fromToolId && e.toToolId === toToolId)
    if (exists) {
      return
    }

    this.edges.push({ fromToolId, toToolId, isSoft })

    // Update in-degree and outgoing edges
    const toNode = this.nodes.get(toToolId)!
    toNode.inDegree++

    const fromNode = this.nodes.get(fromToolId)!
    fromNode.outgoing.add(toToolId)
  }

  /**
   * Remove a dependency.
   */
  removeDependency(fromToolId: string, toToolId: string): void {
    const index = this.edges.findIndex((e) => e.fromToolId === fromToolId && e.toToolId === toToolId)
    if (index === -1) {
      return
    }

    this.edges.splice(index, 1)

    // Update in-degree and outgoing edges
    const toNode = this.nodes.get(toToolId)
    if (toNode) {
      toNode.inDegree--
    }

    const fromNode = this.nodes.get(fromToolId)
    if (fromNode) {
      fromNode.outgoing.delete(toToolId)
    }
  }

  /**
   * Remove all dependencies for a tool (both incoming and outgoing).
   */
  removeTool(toolId: string): void {
    // Remove all edges involving this tool
    this.edges = this.edges.filter((e) => {
      if (e.fromToolId === toolId) {
        const toNode = this.nodes.get(e.toToolId)
        if (toNode) {
          toNode.inDegree--
        }
        return false
      }
      if (e.toToolId === toolId) {
        const fromNode = this.nodes.get(e.fromToolId)
        if (fromNode) {
          fromNode.outgoing.delete(toolId)
        }
        return false
      }
      return true
    })

    // Remove the node itself
    this.nodes.delete(toolId)
  }

  /**
   * Check if a tool is registered.
   */
  hasTool(toolId: string): boolean {
    return this.nodes.has(toolId)
  }

  /**
   * Get all tools registered in the graph.
   */
  getTools(): string[] {
    return Array.from(this.nodes.keys())
  }

  /**
   * Get all dependencies for a specific tool (incoming and outgoing).
   */
  getDependencies(toolId: string): ToolDependency[] {
    return this.edges.filter((e) => e.fromToolId === toolId || e.toToolId === toolId)
  }

  /**
   * Perform topological sort using Kahn's algorithm.
   * Returns groups of tools that can execute in parallel.
   *
   * Example:
   *   A → B, A → C, D → E
   *   Result: [[A, D], [B, C, E]] — A and D can run in parallel,
   *            then B and C and E can run in parallel
   */
  topologicalSort(): TopoSortResult {
    // Create a copy of in-degrees for processing
    const inDegrees = new Map<string, number>()
    for (const [toolId, node] of this.nodes.entries()) {
      inDegrees.set(toolId, node.inDegree)
    }

    // Initialize queue with all nodes having in-degree 0
    const queue: string[] = []
    for (const [toolId, degree] of inDegrees.entries()) {
      if (degree === 0) {
        queue.push(toolId)
      }
    }

    const result: string[][] = []

    while (queue.length > 0) {
      // All nodes in this level can execute in parallel
      result.push([...queue])

      // Process this level
      const nextLevel: string[] = []
      const processed = new Set<string>()

      for (const toolId of queue) {
        const node = this.nodes.get(toolId)!
        for (const neighbor of node.outgoing) {
          const newDegree = inDegrees.get(neighbor)! - 1
          inDegrees.set(neighbor, newDegree)

          if (newDegree === 0 && !processed.has(neighbor)) {
            nextLevel.push(neighbor)
            processed.add(neighbor)
          }
        }
      }

      queue.length = 0
      queue.push(...nextLevel)
    }

    // Check for circular dependencies
    const processedCount = result.reduce((sum, group) => sum + group.length, 0)
    if (processedCount < this.nodes.size) {
      // Find which tools are in the cycle
      const processed = new Set<string>()
      for (const group of result) {
        for (const tool of group) {
          processed.add(tool)
        }
      }

      const cycleTools: string[] = []
      for (const toolId of this.nodes.keys()) {
        if (!processed.has(toolId)) {
          cycleTools.push(toolId)
        }
      }

      return {
        success: false,
        order: result,
        circularDeps: cycleTools,
        error: `Circular dependency detected involving: ${cycleTools.join(', ')}`,
      }
    }

    return {
      success: true,
      order: result,
    }
  }

  /**
   * Detect if there's a circular dependency.
   */
  hasCircularDependency(): boolean {
    const result = this.topologicalSort()
    return !result.success
  }

  /**
   * Get the longest path in the dependency graph (critical path).
   * Useful for estimating total execution time.
   */
  getLongestPath(): { path: string[]; length: number } {
    // Use dynamic programming to compute longest path
    const memo = new Map<string, { path: string[]; length: number }>()

    const dfs = (toolId: string): { path: string[]; length: number } => {
      if (memo.has(toolId)) {
        return memo.get(toolId)!
      }

      const node = this.nodes.get(toolId)!
      let maxPath: string[] = [toolId]
      let maxLength = 1

      // Find the neighbor with the longest path
      for (const neighbor of node.outgoing) {
        const neighborResult = dfs(neighbor)
        const totalLength = 1 + neighborResult.length
        if (totalLength > maxLength) {
          maxLength = totalLength
          maxPath = [toolId, ...neighborResult.path]
        }
      }

      memo.set(toolId, { path: maxPath, length: maxLength })
      return { path: maxPath, length: maxLength }
    }

    // Start from all nodes and find the longest path
    let longestPath: string[] = []
    let maxLength = 0

    for (const toolId of this.nodes.keys()) {
      const result = dfs(toolId)
      if (result.length > maxLength) {
        maxLength = result.length
        longestPath = result.path
      }
    }

    return { path: longestPath, length: maxLength }
  }

  /**
   * Validate the graph structure.
   * Returns validation errors if any.
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = []

    // Check for circular dependencies
    if (this.hasCircularDependency()) {
      errors.push('Graph contains circular dependencies')
    }

    // Check for references to non-existent tools
    for (const edge of this.edges) {
      if (!this.nodes.has(edge.fromToolId)) {
        errors.push(`Dependency refers to non-existent tool: ${edge.fromToolId}`)
      }
      if (!this.nodes.has(edge.toToolId)) {
        errors.push(`Dependency refers to non-existent tool: ${edge.toToolId}`)
      }
    }

    // Check for self-dependencies
    for (const edge of this.edges) {
      if (edge.fromToolId === edge.toToolId) {
        errors.push(`Tool has self-dependency: ${edge.fromToolId}`)
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    }
  }

  /**
   * Clear all tools and dependencies.
   */
  clear(): void {
    this.nodes.clear()
    this.edges = []
  }

  /**
   * Get graph statistics.
   */
  getStats(): {
    toolCount: number
    edgeCount: number
    hasCircularDeps: boolean
    longestPathLength: number
    averageInDegree: number
  } {
    const toolCount = this.nodes.size
    const edgeCount = this.edges.length
    const longestPath = this.getLongestPath()

    let totalInDegree = 0
    for (const node of this.nodes.values()) {
      totalInDegree += node.inDegree
    }

    return {
      toolCount,
      edgeCount,
      hasCircularDeps: this.hasCircularDependency(),
      longestPathLength: longestPath.length,
      averageInDegree: toolCount > 0 ? totalInDegree / toolCount : 0,
    }
  }
}
