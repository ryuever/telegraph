import {
  selectExecutionTarget,
  validateExecutionTargetDefinition,
  type ArtifactTransferPolicy,
  type DomainNetworkPolicy,
  type ExecutionTargetDefinition,
  type ProfileSyncPolicy,
} from '@/packages/computer-use-protocol'

export type IsolatedBrowserRuntimeStatus = 'running' | 'stopped'

export interface IsolatedBrowserRuntimeSession {
  sessionId: string
  status: IsolatedBrowserRuntimeStatus
  definition: ExecutionTargetDefinition
  launchedAt: number
  stoppedAt?: number
  runtimeHandle?: string
}

export interface IsolatedBrowserLaunchInput {
  targetId?: string
  label?: string
  providerId?: string
  domains?: string[]
  blockedDomains?: string[]
  allowPrivateNetwork?: boolean
  persistent?: boolean
  priority?: number
  profileSync?: ProfileSyncPolicy
  artifactTransfer?: ArtifactTransferPolicy
  metadata?: Record<string, unknown>
  now?: number
}

export interface IsolatedBrowserLauncher {
  launch(definition: ExecutionTargetDefinition): Promise<{ runtimeHandle?: string }>
  stop?(session: IsolatedBrowserRuntimeSession): Promise<void>
}

export interface IsolatedBrowserRuntimeOptions {
  providerId?: string
  now?: () => number
  idFactory?: () => string
  launcher?: IsolatedBrowserLauncher
}

export class IsolatedBrowserTargetRuntime {
  private readonly sessions = new Map<string, IsolatedBrowserRuntimeSession>()
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly providerId: string

  constructor(private readonly options: IsolatedBrowserRuntimeOptions = {}) {
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomLocalId
    this.providerId = options.providerId ?? 'telegraph-isolated-browser'
  }

  listSessions(): IsolatedBrowserRuntimeSession[] {
    return Array.from(this.sessions.values()).map(session => structuredClone(session))
  }

  listTargets(): ExecutionTargetDefinition[] {
    return this.listSessions()
      .filter(session => session.status === 'running')
      .map(session => structuredClone(session.definition))
  }

  async launch(input: IsolatedBrowserLaunchInput = {}): Promise<IsolatedBrowserRuntimeSession> {
    const now = input.now ?? this.now()
    const definition = createIsolatedBrowserTargetDefinition(input, {
      providerId: input.providerId ?? this.providerId,
      idFactory: this.idFactory,
    })
    assertLaunchableIsolatedBrowserTarget(definition)

    const launchResult = await this.options.launcher?.launch(definition)
    const session: IsolatedBrowserRuntimeSession = {
      sessionId: `isolated-browser-session-${this.idFactory()}`,
      status: 'running',
      definition,
      launchedAt: now,
      runtimeHandle: launchResult?.runtimeHandle,
    }
    this.sessions.set(session.sessionId, session)
    return structuredClone(session)
  }

  async stop(sessionId: string, now = this.now()): Promise<IsolatedBrowserRuntimeSession | null> {
    const current = this.sessions.get(sessionId)
    if (!current) return null
    if (current.status === 'stopped') return structuredClone(current)

    await this.options.launcher?.stop?.(structuredClone(current))
    const stopped: IsolatedBrowserRuntimeSession = {
      ...current,
      status: 'stopped',
      stoppedAt: now,
    }
    this.sessions.set(sessionId, stopped)
    return structuredClone(stopped)
  }

  selectTarget(input: { domains?: string[] } = {}): ExecutionTargetDefinition | null {
    return selectExecutionTarget(this.listTargets(), {
      requestedKind: 'isolated_browser',
      internetAutomation: true,
      domains: input.domains,
    }).target
  }
}

export function createIsolatedBrowserTargetDefinition(
  input: IsolatedBrowserLaunchInput = {},
  options: { providerId?: string; idFactory?: () => string } = {},
): ExecutionTargetDefinition {
  const targetId = input.targetId ?? `isolated-browser-${options.idFactory?.() ?? randomLocalId()}`
  return {
    target: {
      targetId,
      kind: 'isolated_browser',
      label: input.label ?? 'Isolated Browser',
      scope: {
        includeDomains: input.domains,
        excludeDomains: input.blockedDomains,
      },
    },
    trustLevel: 'ephemeral-isolated',
    providerId: input.providerId ?? options.providerId ?? 'telegraph-isolated-browser',
    enabled: true,
    persistent: input.persistent ?? false,
    priority: input.priority ?? 0,
    networkPolicy: isolatedBrowserNetworkPolicy(input),
    profileSync: input.profileSync ?? {
      mode: 'none',
      homeMount: 'none',
    },
    artifactTransfer: input.artifactTransfer ?? {
      exportMode: 'explicit-approval',
      importMode: 'explicit-approval',
    },
    metadata: {
      runtime: 'isolated-browser',
      ...input.metadata,
    },
  }
}

export function assertLaunchableIsolatedBrowserTarget(definition: ExecutionTargetDefinition): void {
  const errors = validateLaunchableIsolatedBrowserTarget(definition)
  if (errors.length > 0) throw new Error(errors.join('; '))
}

export function validateLaunchableIsolatedBrowserTarget(definition: ExecutionTargetDefinition): string[] {
  const errors = validateExecutionTargetDefinition(definition)
  if (definition.target.kind !== 'isolated_browser') {
    errors.push(`isolated browser runtime requires target kind "isolated_browser", got "${definition.target.kind}"`)
  }
  if (definition.trustLevel !== 'ephemeral-isolated') {
    errors.push(`isolated browser runtime requires trust level "ephemeral-isolated", got "${definition.trustLevel}"`)
  }
  if (definition.profileSync.homeMount && definition.profileSync.homeMount !== 'none') {
    errors.push('isolated browser runtime cannot mount the user home directory')
  }
  if (definition.profileSync.mode === 'managed-profile' && definition.persistent === false) {
    errors.push('managed-profile sync requires a persistent isolated browser target')
  }
  if (definition.artifactTransfer.exportMode === 'workspace-scoped' && definition.artifactTransfer.importMode === 'workspace-scoped') {
    errors.push('isolated browser runtime cannot enable bidirectional workspace-scoped artifact transfer by default')
  }
  return errors
}

function isolatedBrowserNetworkPolicy(input: IsolatedBrowserLaunchInput): DomainNetworkPolicy {
  if (input.domains && input.domains.length > 0) {
    return {
      mode: 'allowlist',
      allowedDomains: input.domains,
      blockedDomains: input.blockedDomains,
      allowPrivateNetwork: input.allowPrivateNetwork ?? false,
    }
  }
  return {
    mode: 'restricted',
    blockedDomains: input.blockedDomains,
    allowPrivateNetwork: input.allowPrivateNetwork ?? false,
  }
}

function randomLocalId(): string {
  return Math.random().toString(36).slice(2)
}
