import type { RuntimeSettings } from '@telegraph/runtime-contracts'
import { PiAiRuntime } from '@telegraph/agent/runtime/PiAiRuntime'
import { PiEmbeddedRuntime } from '@telegraph/agent/runtime/PiEmbeddedRuntime'
import { createLangGraphRuntime } from '@telegraph/agent/runtime/LangGraphRuntime'
import { createVercelAiRuntime } from '@telegraph/agent/runtime/VercelAiRuntime'
import type { RuntimeExecutor } from '@telegraph/agent/runtime/AgentRuntime'
import type { AgentRuntimeSettings } from '@telegraph/agent/types'

/**
 * Factory function to create a RuntimeExecutor instance.
 * 
 * Supports:
 * - pi-ai: LLM-only streaming (in-process)
 * - pi-embedded: Pi-AI with embedded tool loop
 * - langgraph: LangGraph state machine framework
 * 
 * Future roadmap:
 * - Vercel AI SDK adapter
 * - Mastra agents adapter
 * 
 * NOTE: pi-cli (spawned process) is deprecated and removed from the runtime adapter pattern.
 * It was a temporary compatibility layer. Going forward, all execution happens in-process.
 * 
 * @param settings Runtime configuration
 * @returns RuntimeExecutor instance ready to execute runs
 */
export function createRuntime(settings: RuntimeSettings | AgentRuntimeSettings): RuntimeExecutor {
  const backend = (settings as AgentRuntimeSettings).backend ?? 'pi-ai'
  
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
