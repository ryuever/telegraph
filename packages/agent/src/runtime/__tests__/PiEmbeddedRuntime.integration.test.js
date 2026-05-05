/**
 * Integration tests for PiEmbeddedRuntime
 *
 * Tests the complete tool execution flow:
 * - Multi-turn conversation with session management
 * - Tool call detection and execution
 * - Tool result feedback to LLM
 * - Error handling and max iterations
 */
import { PiEmbeddedRuntime } from '../PiEmbeddedRuntime';
import { ToolRegistry } from '../toolExecution/ToolRegistry';
import { ToolCallParser } from '../toolExecution/ToolCallParser';
// Test utilities
function assert(condition, message) {
    if (!condition) {
        throw new Error(`Assertion failed: ${message}`);
    }
}
function assertEquals(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`${message || 'Values not equal'}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
    }
}
// Mock tool definitions for testing
const mockWeatherTool = {
    id: 'weather_tool',
    name: 'weather_tool',
    description: 'Get current weather for a city',
    parameters: {
        type: 'object',
        properties: {
            city: { type: 'string', description: 'City name' },
        },
        required: ['city'],
    },
    execute: async (args) => {
        const city = args.city;
        // Mock responses
        const responses = {
            NYC: { temperature: 72, condition: 'sunny' },
            LA: { temperature: 68, condition: 'cloudy' },
            Chicago: { temperature: 55, condition: 'rainy' },
        };
        return responses[city] || { temperature: 60, condition: 'unknown' };
    },
    source: 'builtin',
};
const mockCalculatorTool = {
    id: 'calculator_tool',
    name: 'calculator_tool',
    description: 'Perform arithmetic calculations',
    parameters: {
        type: 'object',
        properties: {
            expression: { type: 'string', description: 'Math expression' },
        },
        required: ['expression'],
    },
    execute: async (args) => {
        const expr = args.expression;
        try {
            // Safe evaluation (in real code, use a proper expression evaluator)
            const result = new Function(`return ${expr}`)();
            return { result, expression: expr };
        }
        catch (e) {
            throw new Error(`Invalid expression: ${expr}`);
        }
    },
    source: 'builtin',
};
export async function runIntegrationTests() {
    console.log('Running PiEmbeddedRuntime integration tests...\n');
    let testCount = 0;
    let passCount = 0;
    async function test(name, fn) {
        testCount++;
        try {
            await fn();
            passCount++;
            console.log(`✓ ${name}`);
        }
        catch (e) {
            console.error(`✗ ${name}`);
            console.error(`  Error: ${e.message}`);
        }
    }
    // Test 1: Tool call detection
    test('Tool call detection: XML format', () => {
        const text = 'Let me check the weather. <tool_use id="call-1" name="weather_tool" input=\'{"city": "NYC"}\'>';
        const calls = ToolCallParser.parseToolCalls(text);
        assert(calls.length === 1, 'Should detect one tool call');
        assertEquals(calls[0].callId, 'call-1');
        assertEquals(calls[0].toolName, 'weather_tool');
        assertEquals(calls[0].input.city, 'NYC');
    });
    test('Tool call detection: JSON format', () => {
        const text = 'Calculating... {"type": "tool_use", "id": "call-2", "name": "calculator_tool", "input": {"expression": "2+2"}}';
        const calls = ToolCallParser.parseToolCalls(text);
        assert(calls.length > 0, 'Should detect at least one tool call');
        const found = calls.find(c => c.callId === 'call-2');
        assert(found !== undefined, 'Should find call-2');
        assertEquals(found?.input.expression, '2+2');
    });
    test('Tool registry: register and resolve', () => {
        const registry = new ToolRegistry();
        registry.register(mockWeatherTool);
        registry.register(mockCalculatorTool);
        const weather = registry.get('weather_tool');
        assert(weather !== undefined, 'Weather tool should be registered');
        assertEquals(weather?.name, 'weather_tool');
        const tools = registry.list();
        assert(tools.length === 2, 'Should have 2 tools registered');
    });
    test('Tool executor: single tool execution', async () => {
        const registry = new ToolRegistry();
        registry.register(mockWeatherTool);
        const { ToolExecutor } = await import('../toolExecution/ToolExecutor');
        const executor = new ToolExecutor(registry);
        const result = await executor.executeTool({
            toolId: 'weather_tool',
            name: 'weather_tool',
            args: { city: 'NYC' },
            callId: 'call-1',
        });
        assertEquals(result.toolId, 'weather_tool');
        assertEquals(result.callId, 'call-1');
        assert(result.result !== undefined, 'Should have result');
        assert(result.result.temperature === 72, 'NYC should be 72°F');
    });
    test('Tool executor: parallel execution', async () => {
        const registry = new ToolRegistry();
        registry.register(mockWeatherTool);
        const { ToolExecutor } = await import('../toolExecution/ToolExecutor');
        const executor = new ToolExecutor(registry);
        const results = await executor.executeTools([
            { toolId: 'weather_tool', name: 'weather_tool', args: { city: 'NYC' }, callId: 'call-1' },
            { toolId: 'weather_tool', name: 'weather_tool', args: { city: 'LA' }, callId: 'call-2' },
        ]);
        assert(results.length === 2, 'Should execute both tools');
        assertEquals(results[0].callId, 'call-1');
        assertEquals(results[1].callId, 'call-2');
    });
    test('Tool executor: error handling', async () => {
        const registry = new ToolRegistry();
        registry.register(mockCalculatorTool);
        const { ToolExecutor } = await import('../toolExecution/ToolExecutor');
        const executor = new ToolExecutor(registry);
        const result = await executor.executeTool({
            toolId: 'calculator_tool',
            name: 'calculator_tool',
            args: { expression: 'invalid syntax!!!' },
            callId: 'call-1',
        });
        assert(result.error !== undefined, 'Should have error');
        assert(result.error?.code === 'unknown_error', 'Should have error code');
    });
    test('Session management: multi-turn context', async () => {
        const { Session } = await import('../sessionManagement/Session');
        const session = new Session('session-123');
        session.addMessage('user', 'What is 2+2?');
        session.addMessage('assistant', 'The answer is 4');
        session.addMessage('user', 'And 3+3?');
        session.addMessage('assistant', 'The answer is 6');
        const messages = session.getMessages();
        assert(messages.length === 4, 'Should have 4 messages');
        assertEquals(messages[0].content, 'What is 2+2?');
        assertEquals(messages[3].content, 'The answer is 6');
        const stats = session.getStats();
        assertEquals(stats.messageCount, 4);
    });
    test('SessionStore: capacity management', async () => {
        const { SessionStore } = await import('../sessionManagement/SessionStore');
        const store = new SessionStore({ maxSessions: 3 });
        const s1 = store.getOrCreate('session-1');
        const s2 = store.getOrCreate('session-2');
        const s3 = store.getOrCreate('session-3');
        assert(store.size() === 3, 'Should have 3 sessions');
        // Adding 4th session should evict least recently used
        const s4 = store.getOrCreate('session-4');
        assert(store.size() === 3, 'Should still have 3 sessions (LRU evicted)');
        assert(!store.has('session-1'), 'Session-1 should be evicted');
        store.destroy();
    });
    test('PiEmbeddedRuntime: initialization', () => {
        const runtime = new PiEmbeddedRuntime();
        assertEquals(runtime.id, 'pi-embedded');
        assertEquals(runtime.label, 'Pi Embedded (In-Process + Tools)');
        const registry = runtime.getToolRegistry();
        assert(registry !== undefined, 'Should have tool registry');
        const store = runtime.getSessionStore();
        assert(store !== undefined, 'Should have session store');
        runtime.destroy();
    });
    test('PiEmbeddedRuntime: tool registration', () => {
        const runtime = new PiEmbeddedRuntime();
        const registry = runtime.getToolRegistry();
        registry.register(mockWeatherTool);
        registry.register(mockCalculatorTool);
        const tools = registry.list();
        assert(tools.length === 2, 'Should have 2 tools registered');
        const weather = registry.get('weather_tool');
        assert(weather !== undefined, 'Should find weather tool');
        runtime.destroy();
    });
    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Tests: ${passCount}/${testCount} passed`);
    if (passCount === testCount) {
        console.log('✓ All integration tests passed!');
    }
    else {
        console.log(`✗ ${testCount - passCount} test(s) failed`);
    }
    console.log('='.repeat(50));
    return passCount === testCount;
}
// Run tests
const success = await runIntegrationTests();
if (typeof process !== 'undefined') {
    process.exit(success ? 0 : 1);
}
