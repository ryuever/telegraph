import { createId, inject, injectable } from '@x-oasis/di'
import { createRuntime, RunLifecycleManager } from '@telegraph/agent'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@telegraph/runtime-contracts'
import type { RuntimeEvent } from '@telegraph/runtime-contracts'
import type {
  IAgentStreamSink,
  IAgentStreamService,
  LlmTracePayload,
  RunAgentStreamPayload,
  RunAgentStreamResult,
} from '../common/types'
import { agentStreamSinkServicePath } from '@telegraph/services/agent/common/config'
import { ProxyRPCClient } from '@x-oasis/async-call-rpc'
import type { ProcessClientChannel } from '@telegraph/services/port-manager/node/ProcessClientChannel'
import { ProcessClientChannelId } from '@telegraph/services/port-manager/node/ProcessClientChannel'
import { AgentRunRegistry } from './AgentRunRegistry'
import { legacyLlmTraceFromRuntimeEvent } from './runtimeEventForwarding'
import { getExtensionRegistry } from '@telegraph/services/extensions/node/ExtensionRegistry'

export const AgentStreamServiceId = createId('agent-stream-service')

@injectable()
export default class AgentStreamService implements IAgentStreamService {
  private portManager: ProcessClientChannel
  private runRegistry: AgentRunRegistry

  constructor(@inject(ProcessClientChannelId) portManager: ProcessClientChannel) {
    this.portManager = portManager
    this.runRegistry = new AgentRunRegistry()
    this.runRegistry.recoverOrphans()
  }

  private getSink(): IAgentStreamSink {
    return new ProxyRPCClient(agentStreamSinkServicePath, {
      channel: this.portManager.mainProcessChannelProtocol,
    }).createProxy() as unknown as IAgentStreamSink
  }

  async runStream(req: RunAgentStreamPayload): Promise<RunAgentStreamResult> {
    return this.runStreamInternal(req)
  }

  private async runStreamInternal(req: RunAgentStreamPayload): Promise<RunAgentStreamResult> {
    const sink = this.getSink()
    const { webContentsId, runId, message, sessionId: streamSessionId } = req
    const debugContext = {
      runId,
      backend: req.settings.backend ?? 'pi-ai',
      provider: req.settings.provider,
      modelId: req.settings.modelId,
      orchestration: req.settings.orchestration ?? 'none',
      pattern: req.settings.orchestrationPattern ?? null,
      hasApiKey: Boolean(req.settings.apiKey?.trim()),
    }

    // Helper for pushing events to renderer
    const push = (chunk: Parameters<IAgentStreamSink['push']>[0]['chunk']) =>
      sink.push({ webContentsId, chunk })

    // Non-blocking push (fire and forget)
    const safePush = (chunk: Parameters<IAgentStreamSink['push']>[0]['chunk'], stage: string) => {
      void push(chunk).catch(error => {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(
          '[AgentStreamService] sink push failed',
          JSON.stringify({ ...debugContext, stage, error: msg })
        )
      })
    }

    // Blocking push for critical lifecycle events
    const flushPush = async (
      chunk: Parameters<IAgentStreamSink['push']>[0]['chunk'],
      stage: string
    ) => {
      try {
        await push(chunk)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(
          '[AgentStreamService] sink push failed',
          JSON.stringify({ ...debugContext, stage, error: msg })
        )
      }
    }

    const safePushLlmTrace = (trace: LlmTracePayload) =>
      safePush({ type: 'llm_trace', runId, sessionId: streamSessionId ?? '', trace }, 'llm_trace')

    const runStartedMs = Date.now()
    const registry = getExtensionRegistry()
    const blocked = registry.effectiveBlocklist(req.settings.extensionBlocklist)

    // Check for blocklisted orchestration modes
    if (req.settings.orchestration === 'pi-subagents' && blocked.has('pi-subagents')) {
      const err =
        'pi-subagents is blocklisted (Chat settings extension deny list or ~/.telegraph/extension-registry.json).'
      console.warn(
        '[AgentStreamService] orchestration blocked by policy',
        JSON.stringify({ ...debugContext, blocked: [...blocked] })
      )
      safePush({ type: 'run_queued', runId, status: 'queued' }, 'run_queued')
      safePush({ type: 'run_started', runId, status: 'running' }, 'run_started')
      safePush({ type: 'run_failed', runId, status: 'failed', error: err }, 'run_failed')
      safePush({ type: 'error', runId, error: err }, 'error')
      this.runRegistry.markFailed(runId, err)
      return { runId, status: 'failed', error: err }
    }

    // Initialize state management
    const lifecycle = new RunLifecycleManager(runId)
    let textBuffer = ''

    // Runtime event handler - unified for all runtimes
    const handleRuntimeEvent = (ev: RuntimeEvent) => {
      // Process through lifecycle manager (ensures no duplicate terminal events)
      const processed = lifecycle.processRuntimeEvent(ev)
      if (!processed) return // Duplicate terminal event, ignore

      // Forward to renderer
      safePush(
        { type: 'runtime_event', runId, sessionId: streamSessionId ?? '', event: ev },
        'runtime_event'
      )

      // Legacy trace conversion for backward compatibility
      const legacy = legacyLlmTraceFromRuntimeEvent(ev)
      if (legacy) {
        safePushLlmTrace(legacy)
      }

      // Extract text deltas
      if (ev.type === 'assistant_delta' && ev.text) {
        textBuffer += ev.text
        void push({ type: 'text_delta', runId, text: ev.text })
      }

      // Handle terminal states
      if (ev.type === 'run_failed') {
        const msg = `${ev.error.code}: ${ev.error.message}`
        this.runRegistry.markFailed(runId, msg)
        void push({ type: 'run_failed', runId, status: 'failed', error: msg })
        void push({ type: 'error', runId, error: msg })
      }

      if (ev.type === 'run_completed') {
        this.runRegistry.markCompleted(runId)
        void flushPush({ type: 'run_completed', runId, status: 'completed' }, 'run_completed')
        void flushPush({ type: 'done', runId }, 'done')
      }
    }

    try {
      console.info('[AgentStreamService] run accepted', JSON.stringify(debugContext))
      this.runRegistry.markQueued(runId, req.settings.backend, req.settings.orchestration)
      safePush({ type: 'run_queued', runId, status: 'queued' }, 'run_queued')

      this.runRegistry.markRunning(runId)
      safePush({ type: 'run_started', runId, status: 'running' }, 'run_started')

      // Create runtime adapter based on settings
      const runtime = createRuntime(req.settings)
      lifecycle.markRunning()

      console.info('[AgentStreamService] using runtime', JSON.stringify({ runId, runtimeId: runtime.id }))

      // Stream all runtime events
      for await (const ev of runtime.run({
        runId,
        sessionId: streamSessionId,
        message,
        settings: req.settings,
      })) {
        handleRuntimeEvent(ev)

        // Early exit on terminal event
        if (lifecycle.getState() === 'terminal') {
          break
        }
      }

      // Ensure we reached a terminal state
      if (lifecycle.getState() !== 'terminal') {
        const fallback = lifecycle.ensureTerminal({
          code: 'stream_incomplete',
          message: 'Runtime stream ended without terminal event',
        })
        handleRuntimeEvent(fallback)
      }

      const terminal = lifecycle.getTerminalEvent()
      const status = terminal?.type === 'run_completed' ? 'completed' : 'failed'
      const error = terminal?.type === 'run_failed' ? terminal.error.message : undefined

      console.info(
        '[telegraph.metrics] run_terminal',
        JSON.stringify({
          runId,
          backend: debugContext.backend,
          status,
          durationMs: Date.now() - runStartedMs,
        })
      )

      return {
        runId,
        status,
        text: textBuffer,
        error,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(
        '[AgentStreamService] run crashed',
        JSON.stringify({ ...debugContext, error: msg })
      )

      // Ensure terminal state on crash
      if (lifecycle.getState() !== 'terminal') {
        const fallback = lifecycle.ensureTerminal({
          code: 'runtime_crash',
          message: msg,
        })
        handleRuntimeEvent(fallback)
      }

      this.runRegistry.markFailed(runId, msg)
      safePush({ type: 'run_failed', runId, status: 'failed', error: msg }, 'run_failed')
      safePush({ type: 'error', runId, error: msg }, 'error')

      return {
        runId,
        status: 'failed',
        error: msg,
      }
    }
  }
}
