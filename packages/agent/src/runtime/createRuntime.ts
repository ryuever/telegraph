import type { RuntimeSettings } from '@/packages/agent-protocol'
import { PiAiRuntime } from '@/packages/agent/runtime/PiAiRuntime'
import { PiEmbeddedRuntime } from '@/packages/agent/runtime/PiEmbeddedRuntime'
import { createLangGraphRuntime } from '@/packages/agent/runtime/LangGraphRuntime'
import { createVercelAiRuntime } from '@/packages/agent/runtime/VercelAiRuntime'
import type { RuntimeExecutor } from '@/packages/agent/runtime/AgentRuntime'
import type { AgentRuntimeSettings } from '@/packages/agent/types'

/**
 * Factory function to create a RuntimeExecutor instance.
 * 
 * Supports:
 * - pi-ai: LLM-only streaming (in-process)
 * - pi-embedded: Pi-AI with embedded tool loop
 * - pi-subagents: Embedded subagent orchestrator (chain/parallel via pi-ai)
 * - langgraph: LangGraph state machine framework
 * - vercel-ai: Vercel AI SDK adapter
 * 
 * NOTE: pi-cli (spawned process) is deprecated and removed from the runtime adapter pattern.
 * It was a temporary compatibility layer. Going forward, all execution happens in-process.
 * 
 * NOTE: PiSubagentsRuntime is loaded lazily to avoid pulling node:fs into the renderer bundle.
 * 
 * @param settings Runtime configuration
 * @returns RuntimeExecutor instance ready to execute runs
 */
export function createRuntime(settings: RuntimeSettings | AgentRuntimeSettings): RuntimeExecutor {
  const agentSettings = settings as AgentRuntimeSettings
  const backend = agentSettings.backend ?? 'pi-ai'
  
  // Orchestration mode takes precedence over backend selection
  if (agentSettings.orchestration === 'pi-subagents' || backend === 'pi-subagents') {
    // Lazy require to avoid pulling node:fs into the renderer bundle.
    // This code path only executes in the daemon (Node.js) process.
    const { PiSubagentsRuntime } = require('@/packages/agent/runtime/piSubagents/PiSubagentsRuntime') as typeof import('@/packages/agent/runtime/piSubagents/PiSubagentsRuntime')
    return new PiSubagentsRuntime()
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
  
  throw new Error(`[createRuntime] Unknown backend: '${backend}'. Supported: 'pi-ai', 'pi-embedded', 'pi-subagents', 'langgraph', 'vercel-ai'`)
}

/**
 * Create pi-ai runtime explicitly.
 * Useful when you want to ensure pi-ai execution at compile time.
 */
export function createPiAiRuntime(): RuntimeExecutor {
  return new PiAiRuntime()
}
