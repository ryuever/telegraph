import type { ComputerUseBroker } from '@/packages/computer-use'
import type {
  ComputerActionKind,
  ComputerTarget,
  ComputerTargetKind,
} from '@/packages/computer-use-protocol'
import type { ToolDefinition } from '@/packages/agent-protocol'
import type { ToolCapability } from '../CapabilityHost'

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

const ACTION_KINDS = new Set<Exclude<ComputerActionKind, 'observe'>>([
  'click',
  'type',
  'hotkey',
  'scroll',
  'wait',
])

export interface ComputerUseActionToolOptions {
  runId: string
  broker: ComputerUseBroker
  allowedScopes?: string[]
  allowedActions?: string[]
}

export interface ComputerUseActionToolInput {
  target?: ComputerTarget
  kind: Exclude<ComputerActionKind, 'observe'>
  input?: Record<string, unknown>
  approvalId?: string
}

type ParsedComputerUseActionToolInput = Omit<ComputerUseActionToolInput, 'target' | 'input'> & {
  target: ComputerTarget
  input?: Record<string, unknown>
}

export class ComputerUseActionTool implements ToolCapability {
  readonly definition: ToolDefinition = {
    name: 'computer.act',
    title: 'Act On Computer',
    description: 'Execute a controlled computer action through Telegraph ComputerUseBroker. Approval is required by default.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        target: targetSchema(),
        kind: {
          type: 'string',
          enum: [...ACTION_KINDS],
        },
        input: {
          type: 'object',
          additionalProperties: true,
        },
        approvalId: { type: 'string' },
      },
      required: ['kind'],
    },
    metadata: {
      provider: 'telegraph',
    },
  }

  constructor(private readonly options: ComputerUseActionToolOptions) {}

  async execute(input: unknown): Promise<unknown> {
    const parsed = parseInput(input)
    assertActionAllowed(parsed.kind, this.options.allowedActions)
    assertTargetAllowed(parsed.target, this.options.allowedScopes)
    return await this.options.broker.act({
      runId: this.options.runId,
      target: parsed.target,
      kind: parsed.kind,
      input: parsed.input,
      approvalId: parsed.approvalId,
    })
  }
}

function parseInput(input: unknown): ParsedComputerUseActionToolInput {
  if (!isObject(input)) {
    throw new Error('computer.act input must be an object.')
  }
  if (typeof input.kind !== 'string' || !ACTION_KINDS.has(input.kind as Exclude<ComputerActionKind, 'observe'>)) {
    throw new Error(`computer.act kind "${String(input.kind)}" is not supported.`)
  }
  return {
    target: parseTarget(input.target),
    kind: input.kind as Exclude<ComputerActionKind, 'observe'>,
    input: parseActionInput(input.input),
    approvalId: optionalString(input.approvalId),
  }
}

function parseTarget(value: unknown): ComputerTarget {
  if (value === undefined || value === null) return DEFAULT_TARGET
  if (!isObject(value)) {
    throw new Error('computer.act target must be an object.')
  }
  if (typeof value.targetId !== 'string' || value.targetId.length === 0) {
    throw new Error('computer.act target.targetId must be a non-empty string.')
  }
  if (typeof value.kind !== 'string' || !COMPUTER_TARGET_KINDS.has(value.kind as ComputerTargetKind)) {
    throw new Error('computer.act target.kind is not supported.')
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

function parseActionInput(value: unknown): Record<string, unknown> | undefined {
  if (value === undefined || value === null) return undefined
  if (!isObject(value)) {
    throw new Error('computer.act input.input must be an object.')
  }
  return value
}

function assertActionAllowed(
  action: Exclude<ComputerActionKind, 'observe'>,
  allowedActions: string[] | undefined,
): void {
  if (!allowedActions || allowedActions.length === 0) return
  if (allowedActions.includes('*') || allowedActions.includes(action)) return
  throw new Error(`computer.act action "${action}" is outside the allowed action profile.`)
}

function assertTargetAllowed(target: ComputerTarget, allowedScopes: string[] | undefined): void {
  if (!allowedScopes || allowedScopes.length === 0) return
  if (allowedScopes.includes('*') || allowedScopes.includes('computer:act')) return

  const candidates = scopeCandidatesForTarget(target)
  if (!candidates.some(scope => allowedScopes.includes(scope))) {
    throw new Error(`computer.act target "${target.targetId}" is outside the allowed action scopes.`)
  }
}

function scopeCandidatesForTarget(target: ComputerTarget): string[] {
  switch (target.kind) {
    case 'desktop':
      return ['desktop:act']
    case 'app':
      return [
        'app:act',
        target.appId ? `app:${target.appId}:act` : '',
        `target:${target.targetId}:act`,
      ].filter(Boolean)
    case 'window':
      return [
        'window:act',
        target.windowId ? `window:${target.windowId}:act` : '',
        `target:${target.targetId}:act`,
      ].filter(Boolean)
    case 'browser_tab':
      return [
        'browser_tab:act',
        target.browserTabId ? `browser_tab:${target.browserTabId}:act` : '',
        `target:${target.targetId}:act`,
      ].filter(Boolean)
    case 'isolated_browser':
      return ['isolated_browser:act', `target:${target.targetId}:act`]
    case 'vm':
      return ['vm:act', `target:${target.targetId}:act`]
  }
}

function targetSchema(): unknown {
  return {
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
  }
}

function parseScope(value: unknown): ComputerTarget['scope'] {
  if (value === undefined || value === null) return undefined
  if (!isObject(value)) {
    throw new Error('computer.act target.scope must be an object.')
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
