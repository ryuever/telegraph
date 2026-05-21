import type { AgentBackendKind } from '@/packages/agent/types'

export type RuntimeCapabilityKey =
  | 'rawTrace'
  | 'toolApproval'
  | 'childRun'
  | 'resume'
  | 'mcp'
  | 'skills'
  | 'filesystem'
  | 'shell'
  | 'patch'

export type RuntimeCapabilitySupport = 'supported' | 'partial' | 'unsupported'

export interface RuntimeCapabilityItem {
  key: RuntimeCapabilityKey
  label: string
  support: RuntimeCapabilitySupport
  note?: string
}

export type RuntimeProductLayer =
  | 'external-runtime'
  | 'embedded-kernel'
  | 'native-harness'
  | 'orchestrator'

export type RuntimeMaturity = 'ready' | 'scaffold' | 'experimental'

export interface RuntimeCapabilityDescriptor {
  id: AgentBackendKind
  label: string
  summary: string
  productLayer: RuntimeProductLayer
  maturity: RuntimeMaturity
  selectable: boolean
  defaultTaskCapabilityProfile: string
  capabilities: RuntimeCapabilityItem[]
  limitations: string[]
}

export const RUNTIME_CAPABILITY_KEYS: Array<{ key: RuntimeCapabilityKey; label: string }> = [
  { key: 'rawTrace', label: 'Raw trace' },
  { key: 'toolApproval', label: 'Tool approval' },
  { key: 'childRun', label: 'Child run' },
  { key: 'resume', label: 'Resume' },
  { key: 'mcp', label: 'MCP' },
  { key: 'skills', label: 'Skills' },
  { key: 'filesystem', label: 'Filesystem' },
  { key: 'shell', label: 'Shell' },
  { key: 'patch', label: 'Patch' },
]

export const RUNTIME_CAPABILITY_DESCRIPTORS: RuntimeCapabilityDescriptor[] = [
  {
    id: 'pi-ai',
    label: 'pi-ai',
    summary: 'Default SDK-backed model stream with request and provider event trace.',
    productLayer: 'external-runtime',
    maturity: 'ready',
    selectable: true,
    defaultTaskCapabilityProfile: 'default',
    capabilities: [
      capability('rawTrace', 'supported', 'Emits model request and raw stream events.'),
      capability('toolApproval', 'unsupported'),
      capability('childRun', 'unsupported'),
      capability('resume', 'unsupported'),
      capability('mcp', 'unsupported'),
      capability('skills', 'unsupported'),
      capability('filesystem', 'unsupported'),
      capability('shell', 'unsupported'),
      capability('patch', 'unsupported'),
    ],
    limitations: [
      'No embedded tool loop.',
      'No child run orchestration.',
      'Risky local capabilities are unavailable.',
    ],
  },
  {
    id: 'pi-embedded',
    label: 'pi-embedded',
    summary: 'In-process kernel scaffold with session and tool-loop infrastructure.',
    productLayer: 'embedded-kernel',
    maturity: 'scaffold',
    selectable: true,
    defaultTaskCapabilityProfile: 'readonly-workspace',
    capabilities: [
      capability('rawTrace', 'partial', 'Reuses pi-ai stream trace; tool-loop trace is still scaffolded.'),
      capability('toolApproval', 'partial', 'Permission broker exists; renderer approval is Phase D.'),
      capability('childRun', 'unsupported'),
      capability('resume', 'partial', 'In-memory session store only.'),
      capability('mcp', 'unsupported'),
      capability('skills', 'unsupported'),
      capability('filesystem', 'partial', 'Capability host exists, but approval UI is not wired.'),
      capability('shell', 'partial', 'Capability host exists, but approval UI is not wired.'),
      capability('patch', 'partial', 'Patch preview capability exists, but approval UI is not wired.'),
    ],
    limitations: [
      'Tool call detection and multi-step tool loop are not production complete.',
      'Run resume is not persisted across pagelet restart.',
      'Human approval is still default-deny for risky actions.',
    ],
  },
  {
    id: 'telegraph-subagents',
    label: 'telegraph-subagents',
    summary: 'Telegraph native harness for chain or parallel child-agent runs.',
    productLayer: 'native-harness',
    maturity: 'experimental',
    selectable: true,
    defaultTaskCapabilityProfile: 'readonly-workspace',
    capabilities: [
      capability('rawTrace', 'supported', 'Parent and child RuntimeEvents flow into Run Console.'),
      capability('toolApproval', 'partial', 'Permission broker exists; renderer approval is Phase D.'),
      capability('childRun', 'supported', 'Emits child run lifecycle events.'),
      capability('resume', 'unsupported'),
      capability('mcp', 'unsupported'),
      capability('skills', 'partial', 'Uses Telegraph agent profiles; installable skill binding is not complete.'),
      capability('filesystem', 'partial', 'Read/edit capabilities are profile-gated and approval-limited.'),
      capability('shell', 'partial', 'Shell capability is profile-gated and approval-limited.'),
      capability('patch', 'partial', 'Patch capability is profile-gated and approval-limited.'),
    ],
    limitations: [
      'Router is still orchestration-pattern based, not Team Router v0.',
      'No persisted child-run resume.',
      'Human approval UI is not wired yet.',
    ],
  },
  {
    id: 'telegraph-orchestrator',
    label: 'telegraph-orchestrator',
    summary: 'orchestrator-core graph runtime for node, edge, checkpoint, and interrupt events.',
    productLayer: 'orchestrator',
    maturity: 'experimental',
    selectable: false,
    defaultTaskCapabilityProfile: 'default',
    capabilities: [
      capability('rawTrace', 'supported', 'Emits node, edge, checkpoint, interrupt, and raw graph data.'),
      capability('toolApproval', 'unsupported'),
      capability('childRun', 'partial', 'Graph nodes are observable; child agent runs are not first-class yet.'),
      capability('resume', 'partial', 'Interrupt/checkpoint signals exist; UI resume is not wired.'),
      capability('mcp', 'unsupported'),
      capability('skills', 'unsupported'),
      capability('filesystem', 'unsupported'),
      capability('shell', 'unsupported'),
      capability('patch', 'unsupported'),
    ],
    limitations: [
      'Internal graph diagnostics runtime; not exposed as a production chat backend.',
      'No graph builder or runtime selection UI beyond backend selection.',
      'Interrupt resume is not connected to renderer actions.',
    ],
  },
]

export function listRuntimeCapabilityDescriptors(): RuntimeCapabilityDescriptor[] {
  return RUNTIME_CAPABILITY_DESCRIPTORS.map(cloneDescriptor)
}

export function getRuntimeCapabilityDescriptor(
  runtimeId: string | undefined,
): RuntimeCapabilityDescriptor | undefined {
  return RUNTIME_CAPABILITY_DESCRIPTORS.find(item => item.id === runtimeId)
}

export function capabilitySupport(
  descriptor: RuntimeCapabilityDescriptor | undefined,
  key: RuntimeCapabilityKey,
): RuntimeCapabilitySupport {
  return descriptor?.capabilities.find(item => item.key === key)?.support ?? 'unsupported'
}

function capability(
  key: RuntimeCapabilityKey,
  support: RuntimeCapabilitySupport,
  note?: string,
): RuntimeCapabilityItem {
  const label = RUNTIME_CAPABILITY_KEYS.find(item => item.key === key)?.label ?? key
  return { key, label, support, note }
}

function cloneDescriptor(descriptor: RuntimeCapabilityDescriptor): RuntimeCapabilityDescriptor {
  return {
    ...descriptor,
    capabilities: descriptor.capabilities.map(item => ({ ...item })),
    limitations: [...descriptor.limitations],
  }
}
