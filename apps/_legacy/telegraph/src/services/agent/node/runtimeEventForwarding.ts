import type { RuntimeEvent } from '@telegraph/runtime-contracts'
import type { LlmTracePayload } from '../common/types'

function isPiCliProducer(ev: RuntimeEvent): boolean {
  return ev.producerVersion?.includes('pi-cli') ?? false
}

/** Dual-write: derive legacy `LlmTracePayload` rows from contract events (Phase 1). */
export function legacyLlmTraceFromRuntimeEvent(ev: RuntimeEvent): LlmTracePayload | null {
  switch (ev.type) {
    case 'model_request': {
      // pi-cli already emits matching `llm_trace` rows from `runPiCliStream.onLlmTrace`.
      if (isPiCliProducer(ev)) {
        return null
      }
      const raw = ev.raw as { context?: unknown } | undefined
      const ctx = raw?.context
      if (!ctx || typeof ctx !== 'object') return null
      const c = ctx as {
        systemPrompt?: string
        messages?: Array<{ role: string; content: string }>
      }
      return {
        kind: 'pi_ai_request',
        context: ctx,
        options: { hasApiKey: false, signal: false },
        systemPrompt: c.systemPrompt ?? '',
        messages: c.messages ?? [],
      }
    }
    case 'model_event': {
      if (isPiCliProducer(ev)) {
        return null
      }
      return { kind: 'pi_ai_stream_event', event: ev.raw }
    }
    default:
      return null
  }
}
