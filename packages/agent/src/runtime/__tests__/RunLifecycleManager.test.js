/**
 * Unit tests for RunLifecycleManager
 *
 * This file uses plain JavaScript assertions for testing,
 * avoiding external test framework dependencies during initial validation.
 */
import { RunLifecycleManager } from '../RunLifecycleManager';
// Simple assertion helpers
function deepEqual(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(`Assertion failed: ${message || 'Values not equal'}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
    }
}
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
function assertNull(value, message) {
    if (value !== null) {
        throw new Error(`Assertion failed: ${message || 'Expected null'}\nGot: ${value}`);
    }
}
function assertThrows(fn, messagePattern, message) {
    try {
        fn();
        throw new Error(`Expected function to throw, but it did not. ${message || ''}`);
    }
    catch (e) {
        if (e.message.includes('Expected function to throw'))
            throw e;
        if (messagePattern) {
            const errorMsg = e.message;
            if (typeof messagePattern === 'string') {
                if (!errorMsg.includes(messagePattern)) {
                    throw new Error(`Expected error message to include "${messagePattern}", got: ${errorMsg}`);
                }
            }
            else {
                if (!messagePattern.test(errorMsg)) {
                    throw new Error(`Expected error message to match ${messagePattern}, got: ${errorMsg}`);
                }
            }
        }
    }
}
export function runTests() {
    console.log('Running RunLifecycleManager tests...\n');
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
    // State transitions
    test('should start in initial state', () => {
        const manager = new RunLifecycleManager('test-run-1');
        assertEqual(manager.getState(), 'initial');
    });
    test('should transition from initial to running', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        assertEqual(manager.getState(), 'running');
    });
    test('should throw if markRunning called twice', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        assertThrows(() => manager.markRunning(), "Cannot mark running: already in state 'running'");
    });
    test('should throw if markRunning called from terminal state', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const terminalEvent = {
            type: 'run_completed',
            runId: 'test-run-1',
            ts: Date.now(),
        };
        manager.processRuntimeEvent(terminalEvent);
        assertThrows(() => manager.markRunning());
    });
    // Terminal event handling
    test('should handle run_completed as terminal event', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const event = {
            type: 'run_completed',
            runId: 'test-run-1',
            ts: Date.now(),
        };
        const result = manager.processRuntimeEvent(event);
        deepEqual(result, event);
        assertEqual(manager.getState(), 'terminal');
    });
    test('should handle run_failed as terminal event', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const event = {
            type: 'run_failed',
            runId: 'test-run-1',
            error: { code: 'test_error', message: 'Test error' },
            ts: Date.now(),
        };
        const result = manager.processRuntimeEvent(event);
        deepEqual(result, event);
        assertEqual(manager.getState(), 'terminal');
    });
    test('should handle run_cancelled as terminal event', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const event = {
            type: 'run_cancelled',
            runId: 'test-run-1',
            ts: Date.now(),
        };
        const result = manager.processRuntimeEvent(event);
        deepEqual(result, event);
        assertEqual(manager.getState(), 'terminal');
    });
    // Duplicate terminal event handling
    test('should ignore duplicate terminal events', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const firstEvent = {
            type: 'run_completed',
            runId: 'test-run-1',
            ts: Date.now(),
        };
        const secondEvent = {
            type: 'run_failed',
            runId: 'test-run-1',
            error: { code: 'late_error', message: 'Late error' },
            ts: Date.now(),
        };
        const result1 = manager.processRuntimeEvent(firstEvent);
        const result2 = manager.processRuntimeEvent(secondEvent);
        deepEqual(result1, firstEvent);
        assertNull(result2, 'Second event should be ignored');
        deepEqual(manager.getTerminalEvent(), firstEvent);
    });
    // Non-terminal event handling
    test('should pass through non-terminal events', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const event = {
            type: 'model_request',
            runId: 'test-run-1',
            ts: Date.now(),
        };
        const result = manager.processRuntimeEvent(event);
        deepEqual(result, event);
        assertEqual(manager.getState(), 'running');
    });
    test('should pass through multiple non-terminal events', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const event1 = { type: 'model_request', runId: 'test-run-1', ts: Date.now() };
        const event2 = { type: 'model_event', runId: 'test-run-1', ts: Date.now() };
        const event3 = { type: 'tool_call', runId: 'test-run-1', ts: Date.now() };
        const result1 = manager.processRuntimeEvent(event1);
        const result2 = manager.processRuntimeEvent(event2);
        const result3 = manager.processRuntimeEvent(event3);
        deepEqual(result1, event1);
        deepEqual(result2, event2);
        deepEqual(result3, event3);
        assertEqual(manager.getState(), 'running');
    });
    // ensureTerminal fallback
    test('should return stored terminal event if already terminal', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const terminalEvent = {
            type: 'run_completed',
            runId: 'test-run-1',
            ts: Date.now(),
        };
        manager.processRuntimeEvent(terminalEvent);
        const fallback = { code: 'timeout', message: 'Timeout reached' };
        const result = manager.ensureTerminal(fallback);
        deepEqual(result, terminalEvent);
    });
    test('should create synthetic run_failed event if still running', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const fallback = { code: 'timeout', message: 'Timeout reached' };
        const result = manager.ensureTerminal(fallback);
        assertEqual(result.type, 'run_failed');
        assertEqual(result.runId, 'test-run-1');
        deepEqual(result.error, fallback);
        assertTrue(result.synthetic === true);
        assertEqual(manager.getState(), 'terminal');
    });
    test('should have timestamp on synthetic event', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const fallback = { code: 'timeout', message: 'Timeout reached' };
        const result = manager.ensureTerminal(fallback);
        if (result.ts === undefined) {
            throw new Error('Timestamp should be defined');
        }
        assertEqual(typeof result.ts, 'number');
    });
    test('should throw if called from initial state', () => {
        const manager = new RunLifecycleManager('test-run-1');
        const fallback = { code: 'timeout', message: 'Timeout reached' };
        assertThrows(() => manager.ensureTerminal(fallback), "Cannot ensure terminal: invalid state 'initial'");
    });
    // getTerminalEvent
    test('should return null when no terminal event yet', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        assertNull(manager.getTerminalEvent());
    });
    test('should return terminal event after transition', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const event = {
            type: 'run_completed',
            runId: 'test-run-1',
            ts: Date.now(),
        };
        manager.processRuntimeEvent(event);
        deepEqual(manager.getTerminalEvent(), event);
    });
    // Edge cases
    test('should support complex event objects with metadata', () => {
        const manager = new RunLifecycleManager('test-run-1');
        manager.markRunning();
        const complexEvent = {
            type: 'run_completed',
            runId: 'test-run-1',
            ts: Date.now(),
            result: {
                text: 'Hello',
                metadata: {
                    tokenCount: 42,
                    latency: 1234,
                    nested: {
                        deep: 'value',
                    },
                },
            },
        };
        const result = manager.processRuntimeEvent(complexEvent);
        deepEqual(result, complexEvent);
        assertEqual(result.result.metadata.nested.deep, 'value');
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
// Run tests if executed directly
const success = runTests();
if (typeof process !== 'undefined') {
    process.exit(success ? 0 : 1);
}
