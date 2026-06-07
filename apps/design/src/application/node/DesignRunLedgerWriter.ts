import type { AgentEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { AgentRunEventRecord } from '@/packages/agent/persistence/AgentRunRepository'
import { BufferedAgentRunEventWriter } from '@/packages/agent/persistence/BufferedAgentRunEventWriter'
import {
  compactDesignPersistedEvent,
  shouldFlushDesignAssistantSnapshot,
  shouldPersistDesignRunEvent,
} from '@/apps/design/application/common/design-run-ledger'

/**
 * Design-specific run ledger writer. Live UI still receives streaming deltas;
 * persisted JSONL stores compact assistant_message rows instead.
 */
export class DesignRunLedgerWriter {
  private readonly assistantTextByRequest = new Map<string, Map<string, string>>()

  constructor(
    private readonly inner: BufferedAgentRunEventWriter,
  ) {}

  async append(runId: string, event: AgentEvent): Promise<AgentRunEventRecord[]> {
    if (!shouldPersistDesignRunEvent(event)) {
      if (event.type === 'assistant_delta') {
        this.accumulateAssistantDelta(runId, event)
      }
      return []
    }

    const flushed = this.flushAssistantMessages(runId, event)
    const records: AgentRunEventRecord[] = []
    for (const flushedEvent of flushed) {
      records.push(...await this.inner.append(runId, flushedEvent))
    }
    records.push(...await this.inner.append(runId, compactDesignPersistedEvent(event)))
    return records
  }

  flushRun(runId: string): Promise<AgentRunEventRecord[]> {
    return this.flushRunWithAssistant(runId)
  }

  flushAll(): Promise<AgentRunEventRecord[]> {
    const runIds = new Set([...this.assistantTextByRequest.keys()])
    return Promise.all([...runIds].map(runId => this.flushRunWithAssistant(runId)))
      .then(batches => batches.flat())
      .then(pending => this.inner.flushAll().then(rest => [...pending, ...rest]))
  }

  private async flushRunWithAssistant(runId: string): Promise<AgentRunEventRecord[]> {
    const flushed = this.flushAssistantMessages(runId)
    const records: AgentRunEventRecord[] = []
    for (const event of flushed) {
      records.push(...await this.inner.append(runId, event))
    }
    return [...records, ...await this.inner.flushRun(runId)]
  }

  private accumulateAssistantDelta(
    runId: string,
    event: Extract<AgentEvent, { type: 'assistant_delta' }>,
  ): void {
    const byRequest = this.assistantTextByRequest.get(runId) ?? new Map<string, string>()
    byRequest.set(event.requestId, `${byRequest.get(event.requestId) ?? ''}${event.text}`)
    this.assistantTextByRequest.set(runId, byRequest)
  }

  private flushAssistantMessages(runId: string, boundary?: AgentEvent): AgentEvent[] {
    if (boundary && !shouldFlushDesignAssistantSnapshot(boundary)) return []

    const byRequest = this.assistantTextByRequest.get(runId)
    if (!byRequest || byRequest.size === 0) return []

    const events: AgentEvent[] = []
    for (const [requestId, text] of byRequest) {
      const content = text.trim()
      if (!content) continue
      events.push({
        type: 'assistant_message',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'telegraph-design-ledger@0.1.0',
        runId,
        requestId,
        message: {
          id: `${runId}:${requestId}:assistant`,
          role: 'assistant',
          content,
        },
        ts: boundary?.ts ?? Date.now(),
      })
    }

    this.assistantTextByRequest.delete(runId)
    return events
  }
}
