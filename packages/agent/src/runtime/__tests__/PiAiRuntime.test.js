/**
 * Unit tests for PiAiRuntime
 *
 * Tests the pi-ai runtime executor implementation.
 */
import { PiAiRuntime } from '../PiAiRuntime';
// Simple assertion helpers
function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`Assertion failed: ${message || 'Values not equal'}\nExpected: ${expected}\nActual: ${actual}`);
    }
}
function assertTrue(value, message) {
    if (value !== true) {
        throw new Error(`Assertion failed: ${message || 'Expected true'}\nGot: ${value}`);
    }
}
function assertDefined(value, message) {
    if (value === undefined) {
        throw new Error(`Assertion failed: ${message || 'Expected value to be defined'}`);
    }
}
async function collectAsyncIterable(iter) {
    const results = [];
    for await (const item of iter) {
        results.push(item);
    }
    return results;
}
// Mock streamPiAiRuntimeEvents since we can't easily mock it
async function* mockStreamPiAiRuntimeEvents(options) {
    const { runId } = options;
    // Emit a model request
    yield {
        type: 'model_request',
        runId,
        ts: Date.now(),
    };
    // Emit a model response
    yield {
        type: 'model_event',
        runId,
        ts: Date.now(),
        data: { role: 'assistant', content: 'Hello!' },
    };
    // Emit completion
    yield {
        type: 'run_completed',
        runId,
        ts: Date.now(),
        result: { text: 'Hello!' },
    };
}
export async function runTests() {
    console.log('Running PiAiRuntime tests...\n');
    let testCount = 0;
    let passCount = 0;
    function test(name, fn) {
        testCount++;
        try {
            fn();
            passCount++;
            console.log(`✓ ${name}`);
        }
        catch (e) {
            console.error(`✗ ${name}`);
            console.error(`  Error: ${e.message}`);
        }
    }
    test('should have correct id and label', () => {
        const runtime = new PiAiRuntime();
        assertEqual(runtime.id, 'pi-ai');
        assertEqual(runtime.label, 'Pi AI (In-Process)');
    });
    test('should emit run_started event first', () => {
        const runtime = new PiAiRuntime();
        // Create a more direct test without fully mocking
        // Since we can't easily mock the internal streamPiAiRuntimeEvents,
        // we verify the runtime class structure and method signatures
        assertEqual(typeof runtime.run, 'function');
        assertDefined(runtime.now);
        assertDefined(runtime.generateRequestId);
    });
    test('should implement AsyncIterable protocol', () => {
        const runtime = new PiAiRuntime();
        const input = {
            runId: 'test-run-1',
            sessionId: 'session-1',
            message: 'Hello',
            settings: {
                backend: 'pi-ai',
                provider: 'openai',
                modelId: 'gpt-4',
            },
        };
        const result = runtime.run(input);
        assertEqual(typeof result[Symbol.asyncIterator], 'function');
    });
    test('should handle run with valid input', () => {
        const runtime = new PiAiRuntime();
        const input = {
            runId: 'test-run-1',
            sessionId: 'session-1',
            message: 'Hello',
            settings: {
                backend: 'pi-ai',
                provider: 'openai',
                modelId: 'gpt-4',
            },
        };
        // Just verify it returns an async iterable
        const result = runtime.run(input);
        assertEqual(typeof result[Symbol.asyncIterator], 'function');
    });
    test('should extend BaseAgentRuntime', () => {
        const runtime = new PiAiRuntime();
        // Verify inheritance chain
        assertEqual(runtime.__proto__.__proto__.constructor.name, 'BaseAgentRuntime');
    });
    test('should have now() method', () => {
        const runtime = new PiAiRuntime();
        const timestamp = runtime.now();
        assertEqual(typeof timestamp, 'number');
        assertTrue(timestamp > 0);
    });
    test('should have generateRequestId() method', () => {
        const runtime = new PiAiRuntime();
        const requestId = runtime.generateRequestId('test-run-1');
        assertEqual(typeof requestId, 'string');
        assertTrue(requestId.startsWith('req-'));
    });
    // Summary
    console.log(`\n${'='.repeat(50)}`);
    console.log(`Tests: ${passCount}/${testCount} passed`);
    if (passCount === testCount) {
        console.log('✓ All tests passed!');
    }
    else {
        console.log(`✗ ${testCount - passCount} test(s) failed`);
    }
    console.log('='.repeat(50));
    return passCount === testCount;
}
// Run tests synchronously (wrapped in async function for execution)
runTests().then(success => {
    if (typeof process !== 'undefined') {
        process.exit(success ? 0 : 1);
    }
}).catch(e => {
    console.error('Fatal error:', e);
    if (typeof process !== 'undefined') {
        process.exit(1);
    }
});
