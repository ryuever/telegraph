import type { RuntimeSettings } from '@/packages/agent-protocol'
import { PiAiRuntime } from '@/packages/agent/runtime/PiAiRuntime'
import { PiEmbeddedRuntime } from '@/packages/agent/runtime/PiEmbeddedRuntime'
import { createLangGraphRuntime } from '@/packages/agent/runtime/LangGraphRuntime'
import { createVercelAiRuntime } from '@/packages/agent/runtime/VercelAiRuntime'
import type { RuntimeExecutor } from '@/packages/agent/runtime/AgentRuntime'
import type { AgentRuntimeSettings } from '@/packages/agent/types'
import {
  TELEGRAPH_SUBAGENTS_RUNTIME_ID,
  isTelegraphSubagentsSelector,
} from '@/packages/agent/extensions/harness/constants'

/**
 * Factory function to create a RuntimeExecutor instance.
 * 
 * Supports:
 * - pi-ai: LLM-only streaming (in-process)
 * - pi-embedded: Pi-AI with embedded tool loop
 * - langgraph: LangGraph state machine framework
 * - vercel-ai: Vercel AI SDK adapter
 *
 * NOTE: External CLI agents remain outside this embedded runtime factory.
 * They are spawned by the External Agent Runtime path, not represented as
 * framework adapters here.
 *
 * NOTE: first-party extension runtimes such as telegraph-subagents are
 * registered by pagelet-local AgentHarness instances. They are not created
 * by this framework runtime factory.
 * 
 * @param settings Runtime configuration
 * @returns RuntimeExecutor instance ready to execute runs
 */
export function createRuntime(settings: RuntimeSettings | AgentRuntimeSettings): RuntimeExecutor {
  const agentSettings = settings as AgentRuntimeSettings
  const backend = agentSettings.backend ?? 'pi-ai'
  
  // Telegraph native orchestration mode takes precedence over backend selection.
  if (isTelegraphSubagentsSelector(agentSettings.orchestration) || isTelegraphSubagentsSelector(backend)) {
    throw new Error(`[createRuntime] '${TELEGRAPH_SUBAGENTS_RUNTIME_ID}' is a harness extension runtime. Register it on a pagelet-local AgentHarness instead of creating it through createRuntime().`)
  }
  
  if (backend === 'pi-embedded') {
    return new PiEmbeddedRuntime()
  }
  
  if (backend === 'langgraph') {
    return createLangGraphRuntime()
  }
  
  if (backend === 'vercel-ai') {
    return createVercelAiRuntime()
  }
  
  if (backend === 'pi-ai') {
    return new PiAiRuntime()
  }
  
  throw new Error(`[createRuntime] Unknown backend: '${backend}'. Supported: 'pi-ai', 'pi-embedded', 'langgraph', 'vercel-ai'`)
}

/**
 * Create pi-ai runtime explicitly.
 * Useful when you want to ensure pi-ai execution at compile time.
 */
export function createPiAiRuntime(): RuntimeExecutor {
  return new PiAiRuntime()
}
