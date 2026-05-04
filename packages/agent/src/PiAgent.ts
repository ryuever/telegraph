import type { AgentRuntimeSettings } from '@telegraph/agent/types'
import { PiAiBackend } from '@telegraph/agent/backends/PiAiBackend'

/**
 * Backward-compatible alias kept for existing callsites.
 * New code should depend on `AgentBackend` + `createAgentBackend`.
 */
export class PiAgent extends PiAiBackend {
  constructor(settings: AgentRuntimeSettings) {
    super(settings)
  }
}
