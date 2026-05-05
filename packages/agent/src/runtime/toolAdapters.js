/** Map a pi-ai / OpenAI-style tool descriptor into a serializable `ToolDefinition`. */
export function piAiToolLikeToDefinition(tool) {
    return {
        name: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? tool.parameters ?? {},
        metadata: { provider: 'pi' },
    };
}
/** Map a generic JSON-schema tool (e.g. MCP) into `ToolDefinition`. */
export function jsonSchemaToolToDefinition(name, description, schema, metadata) {
    return {
        name,
        description,
        inputSchema: schema ?? {},
        metadata: metadata ?? { provider: 'custom' },
    };
}
