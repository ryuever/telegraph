/**
 * ToolRegistry manages tool definitions and resolution.
 * Tools can come from built-in, extensions, or user-defined sources.
 */
/**
 * In-memory tool registry.
 * Maps tool IDs to tool definitions for resolution and execution.
 */
export class ToolRegistry {
    tools = new Map();
    idToName = new Map(); // Quick lookup: id -> name
    /**
     * Register a tool.
     */
    register(tool) {
        if (this.tools.has(tool.id)) {
            throw new Error(`[ToolRegistry] Tool '${tool.id}' already registered`);
        }
        this.tools.set(tool.id, tool);
        this.idToName.set(tool.id, tool.name);
    }
    /**
     * Unregister a tool.
     */
    unregister(toolId) {
        const existed = this.tools.delete(toolId);
        if (existed) {
            this.idToName.delete(toolId);
        }
        return existed;
    }
    /**
     * Get a tool by ID.
     */
    get(toolId) {
        return this.tools.get(toolId);
    }
    /**
     * Get a tool by name.
     */
    getByName(name) {
        for (const tool of this.tools.values()) {
            if (tool.name === name) {
                return tool;
            }
        }
        return undefined;
    }
    /**
     * List all registered tools.
     */
    list() {
        return Array.from(this.tools.values());
    }
    /**
     * List available tool IDs.
     */
    listIds() {
        return Array.from(this.tools.keys());
    }
    /**
     * Check if a tool is registered.
     */
    has(toolId) {
        return this.tools.has(toolId);
    }
    /**
     * Get registry statistics.
     */
    getStats() {
        const tools = Array.from(this.tools.values());
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
        };
    }
    /**
     * Clear all tools.
     */
    clear() {
        this.tools.clear();
        this.idToName.clear();
    }
}
