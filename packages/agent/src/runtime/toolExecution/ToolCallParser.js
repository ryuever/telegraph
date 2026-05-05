/**
 * Tool Call Parser
 *
 * Detects and parses tool calls from LLM responses.
 * Supports multiple formats:
 * - XML: <tool_use id="..." name="..." input="...">
 * - JSON: {"type": "tool_use", "id": "...", "name": "...", "input": {...}}
 * - Function calling (OpenAI format): {"type": "function", "function": {...}}
 */
export class ToolCallParser {
    /**
     * Parse tool calls from LLM response text.
     * Returns array of detected tool calls.
     */
    static parseToolCalls(text) {
        const calls = [];
        // Try XML format: <tool_use id="call-1" name="weather_tool" input="...">
        calls.push(...this.parseXmlToolCalls(text));
        // Try JSON format in text: {"type": "tool_use", ...}
        calls.push(...this.parseJsonToolCalls(text));
        // Try OpenAI function calling format
        calls.push(...this.parseOpenAiFunctionCalls(text));
        // Remove duplicates (by callId)
        const seen = new Set();
        return calls.filter(call => {
            if (seen.has(call.callId))
                return false;
            seen.add(call.callId);
            return true;
        });
    }
    /**
     * Parse XML-style tool calls.
     * Format: <tool_use id="call-1" name="weather_tool" input="{...}">...</tool_use>
     */
    static parseXmlToolCalls(text) {
        const calls = [];
        // Match <tool_use> tags
        const xmlRegex = /<tool_use\s+id="([^"]+)"\s+name="([^"]+)"\s+input='([^']+)'>/g;
        let match;
        while ((match = xmlRegex.exec(text)) !== null) {
            const [fullMatch, callId, toolName, inputStr] = match;
            try {
                const input = JSON.parse(inputStr);
                calls.push({
                    callId,
                    toolName,
                    input: typeof input === 'object' ? input : { value: input },
                    rawText: fullMatch,
                });
            }
            catch (e) {
                console.warn(`[ToolCallParser] Failed to parse XML tool_use input: ${inputStr}`);
            }
        }
        return calls;
    }
    /**
     * Parse JSON tool calls embedded in text.
     * Format: {"type": "tool_use", "id": "call-1", "name": "weather", "input": {...}}
     */
    static parseJsonToolCalls(text) {
        const calls = [];
        // Try to find JSON objects in the text
        const jsonRegex = /\{[^{}]*"type"\s*:\s*"tool_use"[^{}]*\}/g;
        let match;
        while ((match = jsonRegex.exec(text)) !== null) {
            try {
                const obj = JSON.parse(match[0]);
                if (obj.type === 'tool_use' && obj.id && obj.name) {
                    calls.push({
                        callId: obj.id,
                        toolName: obj.name,
                        input: obj.input ?? obj.parameters ?? {},
                        rawText: match[0],
                    });
                }
            }
            catch (e) {
                // Not valid JSON, continue
            }
        }
        return calls;
    }
    /**
     * Parse OpenAI function calling format.
     * Format: {"type": "function", "function": {"name": "...", "arguments": "{...}"}}
     */
    static parseOpenAiFunctionCalls(text) {
        const calls = [];
        const jsonRegex = /\{[^{}]*"type"\s*:\s*"function"[^{}]*\}/g;
        let match;
        while ((match = jsonRegex.exec(text)) !== null) {
            try {
                const obj = JSON.parse(match[0]);
                if (obj.type === 'function' && obj.function?.name) {
                    const functionCall = obj.function;
                    let input = {};
                    if (typeof functionCall.arguments === 'string') {
                        try {
                            input = JSON.parse(functionCall.arguments);
                        }
                        catch (e) {
                            input = { arguments: functionCall.arguments };
                        }
                    }
                    else if (typeof functionCall.arguments === 'object') {
                        input = functionCall.arguments;
                    }
                    calls.push({
                        callId: `func-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        toolName: functionCall.name,
                        input,
                        rawText: match[0],
                    });
                }
            }
            catch (e) {
                // Not valid JSON, continue
            }
        }
        return calls;
    }
    /**
     * Validate a tool call against registry.
     * Checks:
     * - Tool exists in registry
     * - Required parameters are present
     * - Parameter types match (basic check)
     */
    static validateToolCall(call, toolDefinition) {
        const errors = [];
        // Check tool exists (if definition provided)
        if (toolDefinition) {
            // Validate required parameters
            if (toolDefinition.parameters?.required) {
                for (const required of toolDefinition.parameters.required) {
                    if (!(required in call.input)) {
                        errors.push(`Missing required parameter: ${required}`);
                    }
                }
            }
            // Type validation (basic)
            if (toolDefinition.parameters?.properties) {
                for (const [paramName, paramDef] of Object.entries(toolDefinition.parameters.properties)) {
                    const value = call.input[paramName];
                    if (value !== undefined && value !== null) {
                        const expectedType = paramDef.type;
                        const actualType = typeof value;
                        if (expectedType && actualType !== expectedType && expectedType !== 'object') {
                            errors.push(`Parameter ${paramName}: expected ${expectedType}, got ${actualType}`);
                        }
                    }
                }
            }
        }
        return {
            valid: errors.length === 0,
            errors,
        };
    }
}
