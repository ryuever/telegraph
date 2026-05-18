import type {
  AgentEvent,
  PermissionRequest,
  RuntimeTaskCapabilityProfile,
} from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'

export type PermissionRisk = 'low' | 'medium' | 'high'

export type PermissionCapability = 'filesystem' | 'shell' | 'network'

export type PageletKind = 'chat' | 'design' | 'coding' | 'custom'

export type FilesystemScope = Extract<PermissionRequest, { type: 'filesystem' }>['scope']

export type FilesystemAccess = Extract<PermissionRequest, { type: 'filesystem' }>['access']

export type TaskCapabilityProfile =
  | RuntimeTaskCapabilityProfile
  | { kind: 'pi-extension-compat'; extensionIds: string[] }

export interface PermissionUserIntent {
  summary?: string
  requestedCapabilities?: PermissionCapability[]
}

export interface PageletPermissionPolicy {
  allowedCapabilities?: PermissionCapability[]
  deniedCapabilities?: PermissionCapability[]
}

export interface FilesystemPermissionPolicy {
  readableScopes?: FilesystemScope[]
  writableScopes?: FilesystemScope[]
  deniedScopes?: FilesystemScope[]
  autoGrantWrites?: boolean
}

export interface ShellPermissionPolicy {
  allowedCommands?: string[]
  deniedCommands?: string[]
  maxRisk?: PermissionRisk
  autoGrantUpToRisk?: PermissionRisk
}

export interface NetworkPermissionPolicy {
  allowedHosts?: string[]
  deniedHosts?: string[]
  allowAllHosts?: boolean
}

export interface WorkspacePermissionPolicy {
  filesystem?: FilesystemPermissionPolicy
  shell?: ShellPermissionPolicy
  network?: NetworkPermissionPolicy
}

export type PermissionOperation =
  | {
      kind: 'filesystem.read' | 'filesystem.write'
      path?: string
    }
  | {
      kind: 'shell.exec'
      command?: string
      cwd?: string
      envKeys?: string[]
    }
  | {
      kind: 'network.request'
      host?: string
      url?: string
    }

export interface PermissionBrokerRequestContext {
  runId: string
  sessionId?: string
  pageletId: string
  pageletKind: PageletKind
  taskProfile?: TaskCapabilityProfile
  userIntent?: PermissionUserIntent
  pageletPolicy?: PageletPermissionPolicy
  workspacePolicy?: WorkspacePermissionPolicy
  operation?: PermissionOperation
}

export type PermissionDecisionSource =
  | 'profile'
  | 'workspace-policy'
  | 'user'
  | 'run-cache'
  | 'default-deny'

export interface PermissionDecision {
  granted: boolean
  source: PermissionDecisionSource
  reason: string
  requiresUserDecision?: boolean
  issues?: string[]
}

export interface PermissionPrompt {
  permission: PermissionRequest
  context: PermissionBrokerRequestContext
  proposedDecision: PermissionDecision
}

export type PermissionPromptHandler = (
  prompt: PermissionPrompt,
) => boolean | PermissionDecision | Promise<boolean | PermissionDecision>

export type PermissionEventEmitter = (
  event: AgentEvent,
  context: PermissionBrokerRequestContext,
) => void | Promise<void>

export interface PermissionBrokerOptions {
  prompt?: PermissionPromptHandler
  emit?: PermissionEventEmitter
  cacheUserDecisionsPerRun?: boolean
  now?: () => number
}

const PRODUCER_VERSION = 'telegraph-agent-permission-broker@0.0.0'

const riskOrder: Record<PermissionRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
}

const DEFAULT_TASK_PROFILE: TaskCapabilityProfile = { kind: 'default' }

export class PermissionBroker {
  private readonly prompt?: PermissionPromptHandler
  private readonly emit?: PermissionEventEmitter
  private readonly cacheUserDecisionsPerRun: boolean
  private readonly now: () => number
  private readonly decisionsByRun = new Map<string, Map<string, PermissionDecision>>()

  constructor(options: PermissionBrokerOptions = {}) {
    this.prompt = options.prompt
    this.emit = options.emit
    this.cacheUserDecisionsPerRun = options.cacheUserDecisionsPerRun ?? true
    this.now = options.now ?? Date.now
  }

  evaluatePermission(
    permission: PermissionRequest,
    context: PermissionBrokerRequestContext,
  ): PermissionDecision {
    const pageletDecision = evaluatePageletPolicy(permission, context)
    if (pageletDecision) return pageletDecision

    switch (permission.type) {
      case 'filesystem':
        return this.evaluateFilesystem(permission, context)
      case 'shell':
        return this.evaluateShell(permission, context)
      case 'network':
        return this.evaluateNetwork(permission, context)
      case 'process':
      case 'secrets':
        return deny(
          `Permission type "${permission.type}" is not supported by PermissionBroker MVP`,
          ['Only filesystem, shell, and network permissions are supported in this phase'],
        )
      default:
        return assertNeverPermission(permission)
    }
  }

  async requestPermission(
    permission: PermissionRequest,
    context: PermissionBrokerRequestContext,
  ): Promise<PermissionDecision> {
    this.emitPermissionEvent(permissionRequestedEvent(context.runId, permission, this.now()), context)

    const cached = this.getCachedDecision(permission, context)
    if (cached) {
      const decision: PermissionDecision = {
        ...cached,
        source: 'run-cache',
        reason: `Reusing run-scoped permission decision: ${cached.reason}`,
      }
      this.emitPermissionEvent(permissionResolvedEvent(permission, decision, context, this.now()), context)
      return decision
    }

    const proposedDecision = this.evaluatePermission(permission, context)
    const decision = proposedDecision.requiresUserDecision
      ? await this.resolveWithUserDecision(permission, context, proposedDecision)
      : proposedDecision

    if (this.cacheUserDecisionsPerRun && shouldCacheDecision(decision)) {
      this.setCachedDecision(permission, context, decision)
    }

    this.emitPermissionEvent(permissionResolvedEvent(permission, decision, context, this.now()), context)
    return decision
  }

  clearRun(runId: string): void {
    this.decisionsByRun.delete(runId)
  }

  clear(): void {
    this.decisionsByRun.clear()
  }

  private async resolveWithUserDecision(
    permission: PermissionRequest,
    context: PermissionBrokerRequestContext,
    proposedDecision: PermissionDecision,
  ): Promise<PermissionDecision> {
    if (!this.prompt) {
      return deny('Permission requires user approval but no prompt handler is configured', [
        proposedDecision.reason,
      ])
    }

    const result = await this.prompt({ permission, context, proposedDecision })
    if (typeof result === 'boolean') {
      return result
        ? {
            granted: true,
            source: 'user',
            reason: proposedDecision.reason,
          }
        : deny('User denied permission')
    }

    return {
      granted: result.granted,
      source: 'user',
      reason: result.reason,
      issues: result.issues,
    }
  }

  private evaluateFilesystem(
    permission: Extract<PermissionRequest, { type: 'filesystem' }>,
    context: PermissionBrokerRequestContext,
  ): PermissionDecision {
    const profile = context.taskProfile ?? DEFAULT_TASK_PROFILE
    const policy = context.workspacePolicy?.filesystem

    if (policy?.deniedScopes?.includes(permission.scope)) {
      return deny(`Filesystem scope "${permission.scope}" is denied by workspace policy`)
    }

    if (isReadAccess(permission.access)) {
      if (!profileAllowsFilesystemRead(profile, permission.scope, context.userIntent)) {
        return deny('Filesystem read requires an explicit workspace read task profile')
      }
      if (policy?.readableScopes && !policy.readableScopes.includes(permission.scope)) {
        return deny(`Workspace policy does not allow reading filesystem scope "${permission.scope}"`)
      }
      return {
        granted: true,
        source: policy?.readableScopes ? 'workspace-policy' : 'profile',
        reason: `Filesystem ${permission.scope} read is allowed by the active task profile`,
      }
    }

    if (!profileAllowsFilesystemWrite(profile, permission.scope, context.userIntent)) {
      return deny('Filesystem write requires an explicit edit/build task profile')
    }
    if (policy?.writableScopes && !policy.writableScopes.includes(permission.scope)) {
      return deny(`Workspace policy does not allow writing filesystem scope "${permission.scope}"`)
    }
    if (policy?.autoGrantWrites === true) {
      return {
        granted: true,
        source: 'workspace-policy',
        reason: `Filesystem ${permission.scope} write is auto-granted by workspace policy`,
      }
    }

    return promptRequired(`Filesystem ${permission.scope} write requires user approval`)
  }

  private evaluateShell(
    permission: Extract<PermissionRequest, { type: 'shell' }>,
    context: PermissionBrokerRequestContext,
  ): PermissionDecision {
    const profile = context.taskProfile ?? DEFAULT_TASK_PROFILE
    const policy = context.workspacePolicy?.shell
    const command = context.operation?.kind === 'shell.exec' ? context.operation.command : undefined

    if (!profileAllowsShell(profile, context.userIntent)) {
      return deny('Shell execution requires an explicit shell task profile or user intent')
    }
    if (isRiskAbove(permission.risk, policy?.maxRisk ?? 'medium')) {
      return deny(`Shell risk "${permission.risk}" exceeds workspace policy max risk "${policy?.maxRisk ?? 'medium'}"`)
    }
    if (commandMatches(command, policy?.deniedCommands)) {
      return deny(`Shell command "${command ?? '<unknown>'}" is denied by workspace policy`)
    }
    if (!commandAllowedByProfile(profile, command)) {
      return deny(`Shell command "${command ?? '<unknown>'}" is not allowed by the active task profile`)
    }
    if (!commandAllowedByPolicy(policy, command)) {
      return deny(`Shell command "${command ?? '<unknown>'}" is not allowed by workspace policy`)
    }

    const hasCommandAllowlist = hasShellCommandAllowlist(profile, policy)
    const autoGrantRisk = policy?.autoGrantUpToRisk ?? 'low'
    if (hasCommandAllowlist && !isRiskAbove(permission.risk, autoGrantRisk)) {
      return {
        granted: true,
        source: 'workspace-policy',
        reason: `Shell ${permission.risk}-risk command is allowed by policy`,
      }
    }

    if (permission.risk === 'high' && policy?.maxRisk !== 'high') {
      return deny('High-risk shell execution requires explicit workspace policy maxRisk: "high"')
    }

    return promptRequired(`Shell ${permission.risk}-risk execution requires user approval`)
  }

  private evaluateNetwork(
    permission: Extract<PermissionRequest, { type: 'network' }>,
    context: PermissionBrokerRequestContext,
  ): PermissionDecision {
    const policy = context.workspacePolicy?.network
    const hosts = requestedHosts(permission, context.operation)

    if (!profileAllowsNetwork(context.userIntent)) {
      return deny('Network access requires explicit user intent')
    }
    if (!policy) {
      return deny('Network access requires workspace network policy')
    }
    const deniedHost = hosts.find(host => hostMatchesAny(host, policy.deniedHosts))
    if (deniedHost) {
      return deny(`Network host "${deniedHost}" is denied by workspace policy`)
    }
    if (hosts.length === 0) {
      return policy.allowAllHosts === true
        ? promptRequired('Network access to unspecified hosts requires user approval')
        : deny('Network permission must include at least one host')
    }
    if (policy.allowAllHosts === true || hosts.every(host => hostMatchesAny(host, policy.allowedHosts))) {
      return {
        granted: true,
        source: 'workspace-policy',
        reason: 'Network hosts are allowed by workspace policy',
      }
    }

    return deny('Network hosts are not allowed by workspace policy', hosts)
  }

  private getCachedDecision(
    permission: PermissionRequest,
    context: PermissionBrokerRequestContext,
  ): PermissionDecision | undefined {
    return this.decisionsByRun.get(context.runId)?.get(permissionKey(permission, context.operation))
  }

  private setCachedDecision(
    permission: PermissionRequest,
    context: PermissionBrokerRequestContext,
    decision: PermissionDecision,
  ): void {
    const runDecisions = this.decisionsByRun.get(context.runId) ?? new Map<string, PermissionDecision>()
    runDecisions.set(permissionKey(permission, context.operation), {
      granted: decision.granted,
      source: decision.source,
      reason: decision.reason,
      issues: decision.issues,
    })
    this.decisionsByRun.set(context.runId, runDecisions)
  }

  private emitPermissionEvent(event: AgentEvent, context: PermissionBrokerRequestContext): void {
    if (!this.emit) return
    try {
      void Promise.resolve(this.emit(event, context)).catch(() => {})
    } catch {
      // Permission trace events are observability only; broker decisions must stay usable without them.
    }
  }
}

function profileAllowsFilesystemRead(
  profile: TaskCapabilityProfile,
  scope: FilesystemScope,
  userIntent?: PermissionUserIntent,
): boolean {
  if (scope !== 'workspace') {
    return userIntentAllows(userIntent, 'filesystem')
  }
  if (userIntentAllows(userIntent, 'filesystem')) {
    return true
  }
  const canReadWorkspace =
    profileHasScope(profile, 'workspace:read') ||
    profileHasScope(profile, 'repo:read') ||
    profileHasScope(profile, 'workspace:write') ||
    profileHasScope(profile, 'repo:write')
  return (
    canReadWorkspace &&
    (profile.kind === 'readonly-workspace' || profile.kind === 'coding-edit' || profile.kind === 'design-build')
  )
}

function evaluatePageletPolicy(
  permission: PermissionRequest,
  context: PermissionBrokerRequestContext,
): PermissionDecision | undefined {
  const capability = permissionCapability(permission)
  if (!capability) return undefined

  if (context.pageletPolicy?.deniedCapabilities?.includes(capability)) {
    return deny(`Pagelet "${context.pageletId}" denies ${capability} capability`)
  }
  if (
    context.pageletPolicy?.allowedCapabilities &&
    !context.pageletPolicy.allowedCapabilities.includes(capability)
  ) {
    return deny(`Pagelet "${context.pageletId}" does not allow ${capability} capability`)
  }
  return undefined
}

function permissionCapability(permission: PermissionRequest): PermissionCapability | undefined {
  switch (permission.type) {
    case 'filesystem':
    case 'shell':
    case 'network':
      return permission.type
    case 'process':
    case 'secrets':
      return undefined
    default:
      return assertNeverPermission(permission)
  }
}

function profileAllowsFilesystemWrite(
  profile: TaskCapabilityProfile,
  scope: FilesystemScope,
  userIntent?: PermissionUserIntent,
): boolean {
  if (scope !== 'workspace') {
    return false
  }
  if (!profileHasScope(profile, 'workspace:write') && !profileHasScope(profile, 'repo:write')) {
    return false
  }
  return (
    profile.kind === 'coding-edit' ||
    profile.kind === 'design-build' ||
    userIntentAllows(userIntent, 'filesystem')
  )
}

function profileAllowsShell(profile: TaskCapabilityProfile, userIntent?: PermissionUserIntent): boolean {
  return profile.kind === 'shell-automation' || userIntentAllows(userIntent, 'shell')
}

function profileAllowsNetwork(userIntent?: PermissionUserIntent): boolean {
  return userIntentAllows(userIntent, 'network')
}

function profileHasScope(profile: TaskCapabilityProfile, scope: string): boolean {
  return 'scopes' in profile && profile.scopes.includes(scope)
}

function userIntentAllows(userIntent: PermissionUserIntent | undefined, capability: PermissionCapability): boolean {
  return userIntent?.requestedCapabilities?.includes(capability) ?? false
}

function isReadAccess(access: FilesystemAccess): boolean {
  return access === 'read'
}

function isRiskAbove(risk: PermissionRisk, maxRisk: PermissionRisk): boolean {
  return riskOrder[risk] > riskOrder[maxRisk]
}

function commandAllowedByProfile(profile: TaskCapabilityProfile, command: string | undefined): boolean {
  if (profile.kind !== 'shell-automation' || !profile.commands) return true
  return commandMatches(command, profile.commands)
}

function commandAllowedByPolicy(policy: ShellPermissionPolicy | undefined, command: string | undefined): boolean {
  if (!policy?.allowedCommands) return true
  return commandMatches(command, policy.allowedCommands)
}

function hasShellCommandAllowlist(
  profile: TaskCapabilityProfile,
  policy: ShellPermissionPolicy | undefined,
): boolean {
  return (profile.kind === 'shell-automation' && Boolean(profile.commands?.length)) || Boolean(policy?.allowedCommands?.length)
}

function commandMatches(command: string | undefined, patterns: string[] | undefined): boolean {
  if (!patterns?.length || !command) return false
  return patterns.some(pattern => pattern === '*' || pattern === command)
}

function requestedHosts(
  permission: Extract<PermissionRequest, { type: 'network' }>,
  operation: PermissionOperation | undefined,
): string[] {
  const hosts = new Set<string>()
  for (const host of permission.hosts ?? []) {
    hosts.add(normalizeHost(host))
  }
  if (operation?.kind === 'network.request') {
    if (operation.host) hosts.add(normalizeHost(operation.host))
    if (operation.url) hosts.add(normalizeHost(operation.url))
  }
  return Array.from(hosts).filter(Boolean)
}

function normalizeHost(value: string): string {
  const candidate = value.includes('://') ? value : `https://${value}`
  try {
    return new URL(candidate).hostname.toLowerCase()
  } catch {
    return value.toLowerCase().replace(/:\d+$/, '')
  }
}

function hostMatchesAny(host: string, patterns: string[] | undefined): boolean {
  return patterns?.some(pattern => hostMatches(host, pattern)) ?? false
}

function hostMatches(host: string, pattern: string): boolean {
  const normalizedPattern = normalizeHost(pattern)
  if (normalizedPattern === '*') return true
  if (normalizedPattern.startsWith('*.')) {
    const suffix = normalizedPattern.slice(2)
    return host === suffix || host.endsWith(`.${suffix}`)
  }
  return host === normalizedPattern
}

function shouldCacheDecision(decision: PermissionDecision): boolean {
  return !decision.requiresUserDecision
}

function permissionKey(permission: PermissionRequest, operation: PermissionOperation | undefined): string {
  switch (permission.type) {
    case 'filesystem':
      return `filesystem:${permission.scope}:${permission.access}:${operationKey(operation)}`
    case 'process':
      return `process:${permission.commands?.join(',') ?? '*'}`
    case 'network':
      return `network:${permission.hosts?.map(normalizeHost).sort().join(',') ?? '*'}:${operationKey(operation)}`
    case 'shell':
      return `shell:${permission.risk}:${operationKey(operation)}`
    case 'secrets':
      return `secrets:${permission.keys?.join(',') ?? '*'}`
    default:
      return assertNeverPermission(permission)
  }
}

function operationKey(operation: PermissionOperation | undefined): string {
  if (!operation) return 'operation:*'
  switch (operation.kind) {
    case 'filesystem.read':
    case 'filesystem.write':
      return `${operation.kind}:${operation.path ?? '*'}`
    case 'shell.exec':
      return `${operation.kind}:${operation.command ?? '*'}:${operation.cwd ?? '*'}`
    case 'network.request':
      return `${operation.kind}:${operation.host ? normalizeHost(operation.host) : '*'}:${operation.url ? normalizeHost(operation.url) : '*'}`
    default:
      return assertNeverOperation(operation)
  }
}

function permissionRequestedEvent(runId: string, permission: PermissionRequest, ts: number): AgentEvent {
  return {
    type: 'permission_requested',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: PRODUCER_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'permission-broker' },
    runId,
    permission,
    ts,
  }
}

function permissionResolvedEvent(
  permission: PermissionRequest,
  decision: PermissionDecision,
  context: PermissionBrokerRequestContext,
  ts: number,
): AgentEvent {
  return {
    type: 'permission_resolved',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: PRODUCER_VERSION,
    origin: { framework: 'telegraph', runtimeId: 'permission-broker' },
    runId: context.runId,
    permission,
    granted: decision.granted,
    ts,
    raw: {
      source: decision.source,
      reason: decision.reason,
      issues: decision.issues,
      pageletId: context.pageletId,
      pageletKind: context.pageletKind,
      taskProfile: context.taskProfile?.kind ?? DEFAULT_TASK_PROFILE.kind,
    },
  }
}

function promptRequired(reason: string): PermissionDecision {
  return {
    granted: false,
    source: 'profile',
    reason,
    requiresUserDecision: true,
  }
}

function deny(reason: string, issues?: string[]): PermissionDecision {
  return {
    granted: false,
    source: 'default-deny',
    reason,
    issues,
  }
}

function assertNeverPermission(permission: never): never {
  throw new Error(`Unsupported permission request: ${JSON.stringify(permission)}`)
}

function assertNeverOperation(operation: never): never {
  throw new Error(`Unsupported permission operation: ${JSON.stringify(operation)}`)
}
