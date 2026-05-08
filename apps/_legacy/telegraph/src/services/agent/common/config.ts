/** RPC: daemon-hosted Pi stream execution */
export const agentStreamServicePath = '/services/agent-stream'

/** RPC: main-hosted fan-in for daemon → renderer streaming */
export const agentStreamSinkServicePath = '/services/agent-stream-sink'

export const AgentStreamSinkId = 'agent-stream-sink'

/** IPC (renderer ↔ main) — unchanged contract for UI */
export const AGENT_STREAM_CHANNEL = 'telegraph:agent:stream'
export const AGENT_STREAM_DATA_CHANNEL = 'telegraph:agent:stream:data'
