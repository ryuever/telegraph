import { createId, inject, injectable } from '@x-oasis/di'
import { createAgentBackend } from '@telegraph/agent'
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
import { runPiCliStream } from './runPiCliStream'
import { AgentRunRegistry } from './AgentRunRegistry'

export const AgentStreamServiceId = createId('agent-stream-service')

const PI_AI_DEFAULT_SYSTEM = 'You are a helpful assistant.'

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
    const agent = createAgentBackend(req.settings)
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

    const push = (chunk: Parameters<IAgentStreamSink['push']>[0]['chunk']) =>
      sink.push({ webContentsId, chunk })
    const safePush = (chunk: Parameters<IAgentStreamSink['push']>[0]['chunk'], stage: string) => {
      void push(chunk).catch(error => {
        const msg = error instanceof Error ? error.message : String(error)
        console.error(
          '[AgentStreamService] sink push failed',
          JSON.stringify({ ...debugContext, stage, error: msg })
        )
      })
    }
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
    // const pushLlmTrace = (trace: LlmTracePayload) =>
    //   push({ type: 'llm_trace', runId, sessionId: streamSessionId ?? '', trace })
    const safePushLlmTrace = (trace: LlmTracePayload) =>
      safePush({ type: 'llm_trace', runId, sessionId: streamSessionId ?? '', trace }, 'llm_trace')
    let failed = false
    let finalError = ''
    let textBuffer = ''

    try {
      console.info('[AgentStreamService] run accepted', JSON.stringify(debugContext))
      this.runRegistry.markQueued(runId, req.settings.backend, req.settings.orchestration)
      console.info('[AgentStreamService] pushing run_queued', JSON.stringify(debugContext))
      // Do not await early lifecycle pushes: awaiting sink RPC while the main process is
      // stuck in ipc.invoke(runStream) can deadlock some MessagePort / RPC stacks, and
      // the renderer would never get run_started / text_delta (assistant stuck "pending").
      safePush({ type: 'run_queued', runId, status: 'queued' }, 'run_queued')
      console.info('[AgentStreamService] pushed run_queued', JSON.stringify(debugContext))
      this.runRegistry.markRunning(runId)
      console.info('[AgentStreamService] pushing run_started', JSON.stringify(debugContext))
      safePush({ type: 'run_started', runId, status: 'running' }, 'run_started')
      console.info('[AgentStreamService] pushed run_started', JSON.stringify(debugContext))
      if (req.settings.backend === 'pi-cli') {
        console.info('[AgentStreamService] entering pi-cli stream', JSON.stringify(debugContext))
        await runPiCliStream({
          runId,
          message,
          settings: req.settings,
          onLlmTrace: safePushLlmTrace,
          onTextDelta: (text: string) => {
            textBuffer += text
            void push({ type: 'text_delta', runId, text })
          },
          onError: (reason: string, errorObj: unknown) => {
            failed = true
            let errorMsg = ''
            if (errorObj instanceof Error) {
              errorMsg = errorObj.message
            } else if (typeof errorObj === 'string') {
              errorMsg = errorObj
            } else if (errorObj && typeof errorObj === 'object') {
              try {
                errorMsg = JSON.stringify(errorObj)
              } catch {
                errorMsg = String(errorObj)
              }
            } else {
              errorMsg = String(errorObj)
            }
            const error = `${reason}: ${errorMsg}`
            finalError = error
            console.error(
              '[AgentStreamService] pi-cli run failed',
              JSON.stringify({ ...debugContext, reason, error: errorMsg })
            )
            this.runRegistry.markFailed(runId, error)
            void push({ type: 'run_failed', runId, status: 'failed', error })
            // Legacy compatibility.
            void push({ type: 'error', runId, error })
          },
          onDone: async () => {
            if (failed) {
              return
            }
            console.info('[AgentStreamService] pi-cli run completed', JSON.stringify(debugContext))
            this.runRegistry.markCompleted(runId)
            await flushPush({ type: 'run_completed', runId, status: 'completed' }, 'run_completed')
            await flushPush({ type: 'done', runId }, 'done')
          },
        })
      } else {
        console.log('[AgentStreamService] sending pi-ai request', JSON.stringify(debugContext))
        await agent.send({
          messages: [{ role: 'user', content: message }],
          onPiAiRequest: request =>
            safePushLlmTrace({
              kind: 'pi_ai_request',
              context: request.context,
              options: request.options,
              systemPrompt: request.context.systemPrompt ?? PI_AI_DEFAULT_SYSTEM,
              messages: request.context.messages as Array<{ role: string; content: string }>,
              provider: req.settings.provider,
              modelId: req.settings.modelId,
            }),
          onPiAiStreamEvent: ev =>
            safePushLlmTrace({ kind: 'pi_ai_stream_event', event: ev }),
          callbacks: {
            onTextDelta: (text: string) => {
              textBuffer += text
              void push({ type: 'text_delta', runId, text })
            },
            onError: (reason: string, errorObj: unknown) => {
              failed = true
              let errorMsg = ''
              if (errorObj instanceof Error) {
                errorMsg = errorObj.message
              } else if (typeof errorObj === 'string') {
                errorMsg = errorObj
              } else if (errorObj && typeof errorObj === 'object') {
                try {
                  errorMsg = JSON.stringify(errorObj)
                } catch {
                  errorMsg = String(errorObj)
                }
              } else {
                errorMsg = String(errorObj)
              }
              const error = `${reason}: ${errorMsg}`
              finalError = error
              console.error(
                '[AgentStreamService] pi-ai run failed',
                JSON.stringify({ ...debugContext, reason, error: errorMsg })
              )
              this.runRegistry.markFailed(runId, error)
              void push({ type: 'run_failed', runId, status: 'failed', error })
              // Legacy compatibility.
              void push({ type: 'error', runId, error })
            },
            onDone: () => {
              if (failed) {
                return
              }
              console.info('[AgentStreamService] pi-ai run completed', JSON.stringify(debugContext))
              this.runRegistry.markCompleted(runId)
              void push({ type: 'run_completed', runId, status: 'completed' })
              // Legacy compatibility.
              void push({ type: 'done', runId })
            },
          },
        })
      }
      if (failed) {
        return {
          runId,
          status: 'failed',
          error: finalError || 'agent stream failed',
        }
      }
      return {
        runId,
        status: 'completed',
        text: textBuffer,
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      failed = true
      const errorMessage = msg || String(error)
      console.error(
        '[AgentStreamService] run crashed',
        JSON.stringify({ ...debugContext, error: errorMessage })
      )
      this.runRegistry.markFailed(runId, errorMessage)
      safePush({ type: 'run_failed', runId, status: 'failed', error: errorMessage }, 'run_failed')
      // Legacy compatibility.
      safePush({ type: 'error', runId, error: errorMessage }, 'error')
      return {
        runId,
        status: 'failed',
        error: errorMessage,
      }
    }
  }
}
