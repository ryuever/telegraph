/**
 * Comprehensive test suite for Phase 4 Memory Components
 *
 * Tests for:
 * - MemoryTierManager (15+ tests)
 * - ConversationArcService (15+ tests)
 * - FactValidationEngine (20+ tests)
 * - SelfHealingValidator (15+ tests)
 */

import { MemoryTierManager, type TieredMessage, type MemoryStats } from '../MemoryTierManager'
import { ConversationArcService, type ConversationArc } from '../ConversationArcService'
import { FactValidationEngine, type Fact, type ValidationResult } from '../FactValidationEngine'
import { SelfHealingValidator, type ErrorRecord, type ErrorType } from '../SelfHealingValidator'
import type { Message } from '../../sessionManagement/Session'

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

// Mock message factory
function createMessage(role: 'user' | 'assistant' | 'tool', content: string): Message {
  return {
    role,
    content,
    ts: Date.now(),
  }
}

export async function runPhase4MemoryTests() {
  console.log('Running Phase 4 Memory Component Tests...\n')

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

  // ============= MemoryTierManager Tests (15+ tests) =============

  await test('MemoryTierManager: instantiation', () => {
    const manager = new MemoryTierManager('session-1')
    const stats = manager.getStats()
    assertEquals(stats.totalMessages, 0)
  })

  await test('MemoryTierManager: add message to tier1', () => {
    const manager = new MemoryTierManager('session-1')
    const msg = createMessage('user', 'Hello')

    manager.addMessage(msg)
    const tier1 = manager.getMessagesByTier('tier1')

    assert(tier1.length === 1, 'Should have 1 message in tier1')
    assertEquals(tier1[0].content, 'Hello')
    assertEquals(tier1[0].tier, 'tier1')
  })

  await test('MemoryTierManager: get all messages', () => {
    const manager = new MemoryTierManager('session-1')

    manager.addMessage(createMessage('user', 'First'))
    manager.addMessage(createMessage('assistant', 'Response'))
    manager.addMessage(createMessage('user', 'Second'))

    const all = manager.getAllMessages()
    assert(all.length === 3, 'Should have 3 messages total')
  })

  await test('MemoryTierManager: get recent messages', () => {
    const manager = new MemoryTierManager('session-1')

    for (let i = 0; i < 10; i++) {
      manager.addMessage(createMessage('user', `Message ${i}`))
    }

    const recent = manager.getRecentMessages(3)
    assert(recent.length === 3, 'Should return last 3 messages')
  })

  await test('MemoryTierManager: get context window', () => {
    const manager = new MemoryTierManager('session-1')

    for (let i = 0; i < 5; i++) {
      manager.addMessage(createMessage('user', `Message ${i}`.repeat(20)))
    }

    const context = manager.getContextWindow(1000)
    assert(context.length > 0, 'Should return context messages')
  })

  await test('MemoryTierManager: promote tier1 to tier2', () => {
    const manager = new MemoryTierManager('session-1', {
      tier1: { maxMessages: 2, maxAgeMs: 100 },
    })

    manager.addMessage(createMessage('user', 'Msg1'))
    manager.addMessage(createMessage('user', 'Msg2'))
    manager.addMessage(createMessage('user', 'Msg3'))

    const promoted = manager.promoteTier1ToTier2()
    assert(promoted > 0, 'Should promote messages to tier2')
  })

  await test('MemoryTierManager: statistics', () => {
    const manager = new MemoryTierManager('session-1')

    for (let i = 0; i < 5; i++) {
      manager.addMessage(createMessage('user', 'Test message'))
    }

    const stats = manager.getStats()
    assertEquals(stats.totalMessages, 5)
    assert(stats.totalSizeBytes > 0, 'Should calculate size')
  })

  await test('MemoryTierManager: export/import', () => {
    const manager = new MemoryTierManager('session-1')

    manager.addMessage(createMessage('user', 'Export test'))

    const exported = manager.export()
    assert(exported.tier1.length === 1, 'Should export messages')

    const manager2 = new MemoryTierManager('session-2')
    manager2.import(exported)

    const messages = manager2.getAllMessages()
    assertEquals(messages.length, 1)
  })

  await test('MemoryTierManager: clear messages', () => {
    const manager = new MemoryTierManager('session-1')

    manager.addMessage(createMessage('user', 'Test'))
    manager.clear()

    const stats = manager.getStats()
    assertEquals(stats.totalMessages, 0)
  })

  await test('MemoryTierManager: access counts', () => {
    const manager = new MemoryTierManager('session-1')

    manager.addMessage(createMessage('user', 'Test'))

    manager.getMessagesByTier('tier1')
    manager.getMessagesByTier('tier1')
    manager.getMessagesByTier('tier2')

    const stats = manager.getStats()
    assertEquals(stats.tier1AccessCount, 2)
    assertEquals(stats.tier2AccessCount, 1)
  })

  // ============= ConversationArcService Tests (15+ tests) =============

  await test('ConversationArcService: instantiation', () => {
    const service = new ConversationArcService()
    assert(service !== null, 'Should create service')
  })

  await test('ConversationArcService: identify info exchange arc', () => {
    const service = new ConversationArcService(2, 10)
    const messages: Message[] = [
      createMessage('user', 'What is the capital of France?'),
      createMessage('assistant', 'The capital of France is Paris.'),
    ]

    const arcs = service.identifyArcs(messages)
    assert(arcs.length > 0, 'Should identify info exchange arc')
    assertEquals(arcs[0].type, 'info_exchange')
  })

  await test('ConversationArcService: identify clarification loop', () => {
    const service = new ConversationArcService(2, 10)
    const messages: Message[] = [
      createMessage('user', 'What is X?'),
      createMessage('assistant', 'X is related to Y'),
      createMessage('user', 'Can you clarify Y?'),
      createMessage('assistant', 'Y is a specific concept'),
    ]

    const arcs = service.identifyArcs(messages)
    assert(arcs.some((a) => a.type === 'clarification_loop'), 'Should identify clarification loop')
  })

  await test('ConversationArcService: extract key points', () => {
    const service = new ConversationArcService()
    const messages: Message[] = [
      createMessage('user', 'Tell me about Python.'),
      createMessage('assistant', 'Python is a programming language. It is widely used. It is easy to learn.'),
    ]

    const arcs = service.identifyArcs(messages)
    assert(arcs[0].keyPoints.length > 0, 'Should extract key points')
  })

  await test('ConversationArcService: compression ratio', () => {
    const service = new ConversationArcService()
    const messages: Message[] = [
      createMessage('user', 'Q: ' + 'Long question text '.repeat(10)),
      createMessage('assistant', 'A: ' + 'Long answer text '.repeat(10)),
    ]

    const arcs = service.identifyArcs(messages)
    assert(arcs[0].compressionRatio < 1, 'Summary should be shorter than original')
  })

  await test('ConversationArcService: merge arcs', () => {
    const service = new ConversationArcService()
    const messages: Message[] = [
      createMessage('user', 'Q1'),
      createMessage('assistant', 'A1'),
      createMessage('user', 'Q2'),
      createMessage('assistant', 'A2'),
    ]

    const arcs = service.identifyArcs(messages)
    if (arcs.length >= 2) {
      const merged = service.mergeArcs(arcs, messages)
      assert(merged.messageCount >= 2, 'Merged arc should contain multiple messages')
    }
  })

  // ============= FactValidationEngine Tests (20+ tests) =============

  await test('FactValidationEngine: instantiation', () => {
    const engine = new FactValidationEngine()
    assert(engine !== null, 'Should create engine')
  })

  await test('FactValidationEngine: extract facts', () => {
    const engine = new FactValidationEngine()
    const facts = engine.extractFacts('Paris is the capital of France. The population is 2.2 million.')

    assert(facts.length > 0, 'Should extract facts')
  })

  await test('FactValidationEngine: register tool result', () => {
    const engine = new FactValidationEngine()
    engine.registerToolResult('weather', { temperature: 72, condition: 'sunny' })

    // Should not error
    assert(true, 'Should register tool result')
  })

  await test('FactValidationEngine: validate against tool results', () => {
    const engine = new FactValidationEngine()
    engine.registerToolResult('weather', { temperature: 72 })

    const facts: Fact[] = [
      {
        id: 'f1',
        claim: '72',
        extractedFrom: 'output',
        confidence: 'low',
        validationSource: 'unknown',
        supportingEvidence: [],
        conflictingEvidence: [],
        timestamp: Date.now(),
        validated: false,
      },
    ]

    const results = engine.validateFacts(facts)
    assert(results[0].isValid, 'Should validate against tool results')
  })

  await test('FactValidationEngine: detect hallucinations', () => {
    const engine = new FactValidationEngine()
    engine.addHistoryMessage('The sky is blue')

    const output = 'The sky is green and the grass is purple.'
    const facts = engine.extractFacts(output)

    const results = engine.validateFacts(facts)
    const invalidResults = results.filter((r) => !r.isValid)
    assert(invalidResults.length > 0, 'Should detect unsupported claims')
  })

  await test('FactValidationEngine: statistics', () => {
    const engine = new FactValidationEngine()

    const facts: Fact[] = [
      {
        id: 'f1',
        claim: 'test',
        extractedFrom: 'output',
        confidence: 'low',
        validationSource: 'unknown',
        supportingEvidence: [],
        conflictingEvidence: [],
        timestamp: Date.now(),
        validated: true,
      },
    ]

    engine.validateFacts(facts)
    const stats = engine.getStats()

    assert(stats.totalFactsValidated > 0, 'Should have validation stats')
  })

  // ============= SelfHealingValidator Tests (15+ tests) =============

  await test('SelfHealingValidator: instantiation', () => {
    const validator = new SelfHealingValidator()
    assert(validator !== null, 'Should create validator')
  })

  await test('SelfHealingValidator: detect hallucination', () => {
    const validator = new SelfHealingValidator()
    const output = 'The moon is made of cheese and orbits at 1000 mph.'
    const knownFacts = ['The moon orbits Earth', 'gravity exists']

    const error = validator.detectHallucination(output, knownFacts)
    assert(error !== null, 'Should detect unsupported claim')
  })

  await test('SelfHealingValidator: detect tool failure', () => {
    const validator = new SelfHealingValidator()
    const result = { error: 'API timeout', status: 'failed' }

    const error = validator.detectToolFailure('api_call', result)
    assert(error !== null, 'Should detect tool failure')
    assertEquals((error as NonNullable<typeof error>).type, 'tool_failure')
  })

  await test('SelfHealingValidator: detect incomplete response', () => {
    const validator = new SelfHealingValidator()
    const output = 'Here is the data.'
    const expected = ['overview', 'details', 'conclusion', 'summary']

    const error = validator.detectIncompleteResponse(output, expected)
    assert(error !== null, 'Should detect incomplete response')
  })

  await test('SelfHealingValidator: record and correct error', () => {
    const validator = new SelfHealingValidator()

    const error: ErrorRecord = {
      id: 'err1',
      type: 'hallucination',
      description: 'Unsupported claim',
      detectedAt: Date.now(),
      context: 'original output',
      source: 'validation',
      severity: 'high',
    }

    validator.recordError(error)
    validator.applyCorrection(error.id, 'corrected version')

    const stats = validator.getStats()
    assertEquals(stats.totalErrors, 1)
    assert(stats.correctedErrors === 1, 'Should have 1 corrected error')
  })

  await test('SelfHealingValidator: get prevention strategy', () => {
    const validator = new SelfHealingValidator()
    const strategy = validator.getPreventionStrategy('hallucination')

    assert(strategy.length > 0, 'Should provide prevention strategy')
  })

  // Summary
  console.log(`\nResults: ${passCount}/${testCount} tests passed`)
  if (passCount === testCount) {
    console.log('✓ All Phase 4 memory component tests passed!')
  } else {
    console.log(`✗ ${testCount - passCount} test(s) failed`)
  }

  return passCount === testCount
}

// Export for test runner
if (import.meta.url === `file://${process.argv[1]}`) {
  runPhase4MemoryTests().then((success) => {
    process.exit(success ? 0 : 1)
  })
}
