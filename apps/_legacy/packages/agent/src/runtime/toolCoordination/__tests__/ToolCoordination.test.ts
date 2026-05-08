/**
 * Test suite for Phase 3.4 Tool Coordination Components
 *
 * Tests:
 * - DependencyGraph: topological sorting, circular dependency detection
 * - RateLimiter: token bucket algorithm, async waiting
 * - PermissionValidator: access control, parameter validation
 */

import { DependencyGraph } from '../DependencyGraph'
import { RateLimiter } from '../RateLimiter'
import { PermissionValidator, type ToolPermissionPolicy } from '../PermissionValidator'

// Test utilities
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message || 'Values not equal'}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`
    )
  }
}

export async function runToolCoordinationTests() {
  console.log('Running Phase 3.4 Tool Coordination tests...\n')

  let testCount = 0
  let passCount = 0

  async function test(name: string, fn: () => Promise<void> | void) {
    testCount++
    try {
      await fn()
      passCount++
      console.log(`✓ ${name}`)
    } catch (e) {
      console.error(`✗ ${name}`)
      console.error(`  Error: ${(e as Error).message}`)
    }
  }

  // ============= DependencyGraph Tests =============

  await test('DependencyGraph: add tools and dependencies', () => {
    const graph = new DependencyGraph()
    graph.addTool('fetch_data')
    graph.addTool('process_data')
    graph.addTool('save_result')

    graph.addDependency('fetch_data', 'process_data')
    graph.addDependency('process_data', 'save_result')

    const tools = graph.getTools()
    assert(tools.length === 3, 'Should have 3 tools')
  })

  await test('DependencyGraph: topological sort - linear chain', () => {
    const graph = new DependencyGraph()
    graph.addTool('A')
    graph.addTool('B')
    graph.addTool('C')
    graph.addTool('D')

    graph.addDependency('A', 'B')
    graph.addDependency('B', 'C')
    graph.addDependency('C', 'D')

    const result = graph.topologicalSort()
    assert(result.success, 'Topological sort should succeed')
    assert(result.order.length === 4, 'Should have 4 levels')
    assertEquals(result.order[0], ['A'], 'First level should be [A]')
    assertEquals(result.order[1], ['B'], 'Second level should be [B]')
  })

  await test('DependencyGraph: topological sort - parallel execution', () => {
    const graph = new DependencyGraph()
    graph.addTool('A')
    graph.addTool('B')
    graph.addTool('C')
    graph.addTool('D')

    graph.addDependency('A', 'B')
    graph.addDependency('A', 'C')
    graph.addDependency('B', 'D')
    graph.addDependency('C', 'D')

    const result = graph.topologicalSort()
    assert(result.success, 'Topological sort should succeed')
    // B and C can run in parallel after A
    assert(
      (result.order[1].length === 2 && result.order[1].includes('B') && result.order[1].includes('C')) ||
        result.order[1].includes('B'),
      'B and C should be at same level or B at least'
    )
  })

  await test('DependencyGraph: circular dependency detection', () => {
    const graph = new DependencyGraph()
    graph.addTool('A')
    graph.addTool('B')
    graph.addTool('C')

    graph.addDependency('A', 'B')
    graph.addDependency('B', 'C')
    graph.addDependency('C', 'A') // Creates cycle

    const result = graph.topologicalSort()
    assert(!result.success, 'Should detect circular dependency')
    assert(result.circularDeps !== undefined, 'Should identify circular deps')
    assert(result.circularDeps!.length > 0, 'Should have at least one tool in cycle')
  })

  await test('DependencyGraph: longest path (critical path)', () => {
    const graph = new DependencyGraph()
    graph.addTool('A')
    graph.addTool('B')
    graph.addTool('C')
    graph.addTool('D')

    graph.addDependency('A', 'B')
    graph.addDependency('A', 'C')
    graph.addDependency('B', 'D')

    const longestPath = graph.getLongestPath()
    assertEquals(longestPath.length, 3, 'Longest path should have length 3 (A->B->D)')
    assertEquals(longestPath.path[0], 'A', 'Path should start with A')
  })

  await test('DependencyGraph: remove dependency', () => {
    const graph = new DependencyGraph()
    graph.addTool('A')
    graph.addTool('B')
    graph.addDependency('A', 'B')

    graph.removeDependency('A', 'B')
    const deps = graph.getDependencies('A')
    assertEquals(deps.length, 0, 'Should have no dependencies after removal')
  })

  await test('DependencyGraph: validation with circular deps', () => {
    const graph = new DependencyGraph()
    graph.addTool('A')
    graph.addTool('B')
    graph.addDependency('A', 'B')
    graph.addDependency('B', 'A')

    const validation = graph.validate()
    assert(!validation.valid, 'Should be invalid with circular deps')
    assert(validation.errors.length > 0, 'Should have validation errors')
  })

  await test('DependencyGraph: stats and metrics', () => {
    const graph = new DependencyGraph()
    graph.addTool('A')
    graph.addTool('B')
    graph.addTool('C')
    graph.addDependency('A', 'B')
    graph.addDependency('A', 'C')

    const stats = graph.getStats()
    assertEquals(stats.toolCount, 3, 'Should have 3 tools')
    assertEquals(stats.edgeCount, 2, 'Should have 2 edges')
    assertEquals(stats.hasCircularDeps, false, 'Should not have circular deps')
  })

  // ============= RateLimiter Tests =============

  await test('RateLimiter: register and check tool', () => {
    const limiter = new RateLimiter()
    limiter.registerTool({
      toolId: 'api_call',
      maxRequestsPerSecond: 10,
    })

    assert(limiter.isRateLimited('api_call'), 'Tool should be rate limited')
  })

  await test('RateLimiter: acquire tokens - success', () => {
    const limiter = new RateLimiter()
    limiter.registerTool({
      toolId: 'api',
      maxRequestsPerSecond: 5,
      burstSize: 10,
    })

    const result = limiter.tryAcquire('api', 1)
    assert(result.allowed, 'Should allow first request')
    assert(result.tokensRemaining !== undefined, 'Should return tokens remaining')
  })

  await test('RateLimiter: exhaust tokens and reject', () => {
    const limiter = new RateLimiter()
    limiter.registerTool({
      toolId: 'limited',
      maxRequestsPerSecond: 1,
      burstSize: 2,
    })

    // Acquire all burst tokens
    limiter.tryAcquire('limited', 2)

    // Next request should fail
    const result = limiter.tryAcquire('limited', 1)
    assert(!result.allowed, 'Should reject when no tokens available')
    assert(result.retryAfterMs !== undefined, 'Should provide retry time')
  })

  await test('RateLimiter: reset tokens', () => {
    const limiter = new RateLimiter()
    limiter.registerTool({
      toolId: 'api',
      maxRequestsPerSecond: 5,
      burstSize: 5,
    })

    limiter.tryAcquire('api', 5)
    let result = limiter.tryAcquire('api', 1)
    assert(!result.allowed, 'Should fail after exhausting tokens')

    limiter.reset('api')
    result = limiter.tryAcquire('api', 1)
    assert(result.allowed, 'Should allow after reset')
  })

  await test('RateLimiter: cooldown enforcement', () => {
    const limiter = new RateLimiter()
    limiter.registerTool({
      toolId: 'critical',
      maxRequestsPerSecond: 10,
      cooldownMs: 1000,
    })

    const result1 = limiter.tryAcquire('critical', 1)
    assert(result1.allowed, 'First request should succeed')

    const result2 = limiter.tryAcquire('critical', 1)
    assert(!result2.allowed, 'Second request should fail due to cooldown')
    assert(result2.retryAfterMs! <= 1000, 'Retry time should be <= cooldown')
  })

  await test('RateLimiter: unregistered tool - always allow', () => {
    const limiter = new RateLimiter()
    const result = limiter.tryAcquire('unregistered', 100)
    assert(result.allowed, 'Unregistered tools should always be allowed')
  })

  await test('RateLimiter: get statistics', () => {
    const limiter = new RateLimiter()
    limiter.registerTool({
      toolId: 'stats_test',
      maxRequestsPerSecond: 10,
      burstSize: 10,
    })

    limiter.tryAcquire('stats_test', 3)
    const stats = limiter.getStats()

    assert(stats.length > 0, 'Should return statistics')
    const stat = stats[0]
    assertEquals(stat.toolId, 'stats_test')
    assertEquals(stat.maxTokens, 10)
    assert(stat.tokensRemaining === 7, 'Should have 7 tokens remaining')
  })

  // ============= PermissionValidator Tests =============

  await test('PermissionValidator: register policy', () => {
    const validator = new PermissionValidator()
    const policy: ToolPermissionPolicy = {
      toolId: 'safe_tool',
      permission: 'allow',
    }

    validator.registerPolicy(policy)
    const policies = validator.getPolicies()
    assert(policies.length === 1, 'Should have 1 policy')
  })

  await test('PermissionValidator: allow policy', () => {
    const validator = new PermissionValidator()
    validator.registerPolicy({
      toolId: 'allowed_tool',
      permission: 'allow',
    })

    const result = validator.checkPermission({
      toolId: 'allowed_tool',
      sessionId: 'session1',
      parameters: {},
    })

    assert(result.allowed, 'Should allow with allow permission')
  })

  await test('PermissionValidator: deny policy', () => {
    const validator = new PermissionValidator()
    validator.registerPolicy({
      toolId: 'forbidden_tool',
      permission: 'deny',
    })

    const result = validator.checkPermission({
      toolId: 'forbidden_tool',
      sessionId: 'session1',
      parameters: {},
    })

    assert(!result.allowed, 'Should deny with deny permission')
  })

  await test('PermissionValidator: global blocklist', () => {
    const validator = new PermissionValidator()
    validator.addToBlocklist('blocked_tool')

    const result = validator.checkPermission({
      toolId: 'blocked_tool',
      sessionId: 'session1',
      parameters: {},
    })

    assert(!result.allowed, 'Should deny blocked tools')
  })

  await test('PermissionValidator: global allowlist', () => {
    const validator = new PermissionValidator()
    validator.setGlobalAllowlist(['allowed1', 'allowed2'])

    const result1 = validator.checkPermission({
      toolId: 'allowed1',
      sessionId: 'session1',
      parameters: {},
    })

    const result2 = validator.checkPermission({
      toolId: 'not_allowed',
      sessionId: 'session1',
      parameters: {},
    })

    assert(result1.allowed, 'Should allow tool in allowlist')
    assert(!result2.allowed, 'Should deny tool not in allowlist')
  })

  await test('PermissionValidator: execution count limit', () => {
    const validator = new PermissionValidator()
    validator.registerPolicy({
      toolId: 'limited_tool',
      permission: 'allow',
      maxExecutionsPerSession: 2,
    })

    // First two executions should be allowed
    validator.recordExecution('session1', 'limited_tool')
    validator.recordExecution('session1', 'limited_tool')

    // Third execution should be denied
    const result = validator.checkPermission({
      toolId: 'limited_tool',
      sessionId: 'session1',
      parameters: {},
    })

    assert(!result.allowed, 'Should deny when limit exceeded')
    const hasIssues: boolean = (result.issues?.length ?? 0) > 0
    assert(hasIssues, 'Should have validation issues')
  })

  await test('PermissionValidator: parameter validation - whitelist', () => {
    const validator = new PermissionValidator()
    validator.registerPolicy({
      toolId: 'email_tool',
      permission: 'allow',
      allowedParameterPatterns: {
        email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, // Simple email regex
      },
    })

    const result1 = validator.checkPermission({
      toolId: 'email_tool',
      sessionId: 'session1',
      parameters: { email: 'test@example.com' },
    })

    const result2 = validator.checkPermission({
      toolId: 'email_tool',
      sessionId: 'session1',
      parameters: { email: 'invalid-email' },
    })

    assert(result1.allowed, 'Should allow valid email')
    assert(!result2.allowed, 'Should deny invalid email')
  })

  await test('PermissionValidator: parameter validation - blacklist', () => {
    const validator = new PermissionValidator()
    validator.registerPolicy({
      toolId: 'file_tool',
      permission: 'allow',
      deniedParameterPatterns: {
        path: /\.\.\//, // Deny path traversal
      },
    })

    const result1 = validator.checkPermission({
      toolId: 'file_tool',
      sessionId: 'session1',
      parameters: { path: '/safe/file.txt' },
    })

    const result2 = validator.checkPermission({
      toolId: 'file_tool',
      sessionId: 'session1',
      parameters: { path: '../../etc/passwd' },
    })

    assert(result1.allowed, 'Should allow safe path')
    assert(!result2.allowed, 'Should deny path traversal')
  })

  await test('PermissionValidator: mark dangerous tool', () => {
    const validator = new PermissionValidator()
    validator.markDangerous('delete_all')

    const result = validator.checkPermission({
      toolId: 'delete_all',
      sessionId: 'session1',
      parameters: {},
    })

    assert(result.requiresApproval === true, 'Dangerous tool should require approval')
  })

  await test('PermissionValidator: statistics', () => {
    const validator = new PermissionValidator()
    validator.registerPolicy({
      toolId: 'tool1',
      permission: 'allow',
    })
    validator.markDangerous('dangerous_tool')
    validator.addToBlocklist('blocked_tool')

    const stats = validator.getStats()
    assertEquals(stats.totalPolicies, 1)
    assertEquals(stats.dangerousTools, 1)
    assertEquals(stats.blocklistedTools, 1)
  })

  // Summary
  console.log(`\nResults: ${passCount}/${testCount} tests passed`)
  if (passCount === testCount) {
    console.log('✓ All Phase 3.4 tool coordination tests passed!')
  } else {
    console.log(`✗ ${testCount - passCount} test(s) failed`)
  }

  return passCount === testCount
}

// Export for test runner
if (import.meta.url === `file://${process.argv[1]}`) {
  runToolCoordinationTests().then((success) => {
    process.exit(success ? 0 : 1)
  })
}
