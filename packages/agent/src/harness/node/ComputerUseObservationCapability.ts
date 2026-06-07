import type { ComputerUseBroker } from '@/packages/computer-use'
import type {
  ComputerTarget,
  ComputerTargetKind,
  ObservationKind,
} from '@/packages/computer-use-protocol'
import type { ToolDefinition } from '@/packages/agent-protocol'
import type { ToolCapability } from '@/packages/agent-capabilities'

const DEFAULT_TARGET: ComputerTarget = {
  targetId: 'desktop:main',
  kind: 'desktop',
  label: 'Main desktop',
}

const COMPUTER_TARGET_KINDS = new Set<ComputerTargetKind>([
  'desktop',
  'app',
  'window',
  'browser_tab',
  'isolated_browser',
  'vm',
])

const OBSERVATION_KINDS = new Set<ObservationKind>([
  'screenshot',
  'window_list',
  'accessibility_tree',
  'ocr_text',
])

export interface ComputerUseObservationToolOptions {
  runId: string
  broker: ComputerUseBroker
  allowedScopes?: string[]
}

export interface ComputerUseObservationToolInput {
  target?: ComputerTarget
  kinds?: ObservationKind[]
}

export class ComputerUseObservationTool implements ToolCapability {
  readonly definition: ToolDefinition = {
    name: 'computer.observe',
    title: 'Observe Computer',
    description: 'Capture read-only computer observations such as screenshots or window lists and return artifact references.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: {
          type: 'object',
          additionalProperties: false,
          properties: {
            targetId: { type: 'string' },
            kind: {
              type: 'string',
              enum: [...COMPUTER_TARGET_KINDS],
            },
            label: { type: 'string' },
            appId: { type: 'string' },
            windowId: { type: 'string' },
            browserTabId: { type: 'string' },
            scope: {
              type: 'object',
              additionalProperties: false,
              properties: {
                includeApps: { type: 'array', items: { type: 'string' } },
                excludeApps: { type: 'array', items: { type: 'string' } },
                includeDomains: { type: 'array', items: { type: 'string' } },
                excludeDomains: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          required: ['targetId', 'kind'],
        },
        kinds: {
          type: 'array',
          items: {
            type: 'string',
            enum: [...OBSERVATION_KINDS],
          },
        },
      },
    },
    metadata: {
      provider: 'telegraph',
    },
  }

  constructor(private readonly options: ComputerUseObservationToolOptions) {}

  async execute(input: unknown): Promise<unknown> {
    const parsed = parseInput(input)
    assertTargetAllowed(parsed.target, this.options.allowedScopes)
    const observations = await this.options.broker.observe({
      runId: this.options.runId,
      target: parsed.target,
      kinds: parsed.kinds,
    })

    return { observations }
  }
}

function parseInput(input: unknown): Required<ComputerUseObservationToolInput> {
  if (input === undefined || input === null) {
    return {
      target: DEFAULT_TARGET,
      kinds: ['screenshot'],
    }
  }
  if (!isObject(input)) {
    throw new Error('computer.observe input must be an object.')
  }

  return {
    target: parseTarget(input.target),
    kinds: parseKinds(input.kinds),
  }
}

function assertTargetAllowed(target: ComputerTarget, allowedScopes: string[] | undefined): void {
  if (!allowedScopes || allowedScopes.length === 0) return
  if (allowedScopes.includes('*') || allowedScopes.includes('computer:observe')) return

  const candidates = scopeCandidatesForTarget(target)
  if (!candidates.some(scope => allowedScopes.includes(scope))) {
    throw new Error(`computer.observe target "${target.targetId}" is outside the allowed observation scopes.`)
  }
}

function scopeCandidatesForTarget(target: ComputerTarget): string[] {
  switch (target.kind) {
    case 'desktop':
      return ['desktop:read']
    case 'app':
      return [
        'app:read',
        target.appId ? `app:${target.appId}:read` : '',
        `target:${target.targetId}:read`,
      ].filter(Boolean)
    case 'window':
      return [
        'window:read',
        target.windowId ? `window:${target.windowId}:read` : '',
        `target:${target.targetId}:read`,
      ].filter(Boolean)
    case 'browser_tab':
      return [
        'browser_tab:read',
        target.browserTabId ? `browser_tab:${target.browserTabId}:read` : '',
        `target:${target.targetId}:read`,
      ].filter(Boolean)
    case 'isolated_browser':
      return ['isolated_browser:read', `target:${target.targetId}:read`]
    case 'vm':
      return ['vm:read', `target:${target.targetId}:read`]
  }
}

function parseTarget(value: unknown): ComputerTarget {
  if (value === undefined || value === null) return DEFAULT_TARGET
  if (!isObject(value)) {
    throw new Error('computer.observe target must be an object.')
  }
  if (typeof value.targetId !== 'string' || value.targetId.length === 0) {
    throw new Error('computer.observe target.targetId must be a non-empty string.')
  }
  if (typeof value.kind !== 'string' || !COMPUTER_TARGET_KINDS.has(value.kind as ComputerTargetKind)) {
    throw new Error('computer.observe target.kind is not supported.')
  }

  return {
    targetId: value.targetId,
    kind: value.kind as ComputerTargetKind,
    label: optionalString(value.label),
    appId: optionalString(value.appId),
    windowId: optionalString(value.windowId),
    browserTabId: optionalString(value.browserTabId),
    scope: parseScope(value.scope),
  }
}

function parseKinds(value: unknown): ObservationKind[] {
  if (value === undefined || value === null) return ['screenshot']
  if (!Array.isArray(value)) {
    throw new Error('computer.observe kinds must be an array.')
  }
  if (value.length === 0) return ['screenshot']
  return value.map(kind => {
    if (typeof kind !== 'string' || !OBSERVATION_KINDS.has(kind as ObservationKind)) {
      throw new Error(`computer.observe kind "${String(kind)}" is not supported.`)
    }
    return kind as ObservationKind
  })
}

function parseScope(value: unknown): ComputerTarget['scope'] {
  if (value === undefined || value === null) return undefined
  if (!isObject(value)) {
    throw new Error('computer.observe target.scope must be an object.')
  }
  return {
    includeApps: optionalStringList(value.includeApps),
    excludeApps: optionalStringList(value.excludeApps),
    includeDomains: optionalStringList(value.includeDomains),
    excludeDomains: optionalStringList(value.excludeDomains),
  }
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function optionalStringList(value: unknown): string[] | undefined {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value)) return undefined
  return value.filter(item => typeof item === 'string')
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
