import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent } from '@/packages/agent-protocol'
import { describe, expect, it, vi } from 'vitest'
import { FileAgentRunRepository } from '@/packages/agent/persistence/AgentRunRepository'
import type { AgentRunEventRecord } from '@/packages/agent/persistence/AgentRunRepository'
import { BufferedAgentRunEventWriter } from '@/packages/agent/persistence/BufferedAgentRunEventWriter'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { sanitizeDesignRunConsoleEvents, shouldPersistDesignRunEvent } from '@/apps/design/application/common/design-run-ledger'
import { DesignRunLedgerWriter } from '../DesignRunLedgerWriter'

describe('DesignRunLedgerWriter', () => {
  it('drops model_event and assistant_delta but persists final assistant_message', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'design-ledger-'))
    try {
      const repo = new FileAgentRunRepository(dir)
      await repo.createRun({ runId: 'run-1', sessionId: 'session-1', runtimeId: 'telegraph-design-build' })
      const inner = new BufferedAgentRunEventWriter(repo)
      const writer = new DesignRunLedgerWriter(inner)

      await writer.append('run-1', runStarted())
      await writer.append('run-1', modelEvent())
      await writer.append('run-1', assistantDelta('hello '))
      await writer.append('run-1', assistantDelta('world'))
      await writer.flushRun('run-1')

      const events = await repo.listRunEvents('run-1')
      expect(events.some(record => record.event.type === 'model_event')).toBe(false)
      expect(events.some(record => record.event.type === 'assistant_delta')).toBe(false)
      const assistant = events.find(record => record.event.type === 'assistant_message')
      expect(assistant?.event).toMatchObject({
        type: 'assistant_message',
        requestId: 'req-1',
        message: { role: 'assistant', content: 'hello world' },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('flushes assistant text before tool_call', async () => {
    const append = vi.fn<(runId: string, event: AgentEvent) => Promise<AgentRunEventRecord[]>>(() => Promise.resolve([]))
    const inner = {
      append,
      flushRun: vi.fn(() => Promise.resolve([])),
      flushAll: vi.fn(() => Promise.resolve([])),
    }
    const writer = new DesignRunLedgerWriter(inner as never)

    await writer.append('run-1', assistantDelta('draft'))
    await writer.append('run-1', toolCall())

    expect(append).toHaveBeenCalledTimes(2)
    expect(append.mock.calls[0]?.[1]).toMatchObject({
      type: 'assistant_message',
      message: { content: 'draft' },
    })
    expect(append.mock.calls[1]?.[1]).toMatchObject({ type: 'tool_call' })
  })
})

describe('sanitizeDesignRunConsoleEvents', () => {
  it('collapses legacy delta rows for run console display', () => {
    const sanitized = sanitizeDesignRunConsoleEvents([
      modelEvent(),
      assistantDelta('a'),
      assistantDelta('b'),
      toolCall(),
    ])

    expect(sanitized.map(event => event.type)).toEqual([
      'assistant_message',
      'tool_call',
    ])
  })
})

describe('shouldPersistDesignRunEvent', () => {
  it('rejects high-volume stream events', () => {
    expect(shouldPersistDesignRunEvent(modelEvent())).toBe(false)
    expect(shouldPersistDesignRunEvent(assistantDelta('x'))).toBe(false)
    expect(shouldPersistDesignRunEvent(toolCall())).toBe(true)
  })
})

function runStarted(): AgentEvent {
  return {
    type: 'run_started',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    ts: 1,
  }
}

function modelEvent(): AgentEvent {
  return {
    type: 'model_event',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    requestId: 'req-1',
    raw: { type: 'text_delta', partial: { huge: true } },
    ts: 2,
  }
}

function assistantDelta(text: string): AgentEvent {
  return {
    type: 'assistant_delta',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    requestId: 'req-1',
    text,
    ts: 3,
  }
}

function toolCall(): AgentEvent {
  return {
    type: 'tool_call',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    runId: 'run-1',
    callId: 'call-1',
    toolName: 'submit_design_child_output',
    input: { ok: true },
    ts: 4,
  }
}
