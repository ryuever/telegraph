import {
  selectExecutionTarget,
  validateExecutionTargetDefinition,
  type ArtifactTransferPolicy,
  type DomainNetworkPolicy,
  type ExecutionTargetDefinition,
  type HomeMountPolicy,
  type ProfileSyncPolicy,
} from '@/packages/computer-use-protocol'

export type VmDesktopRuntimeStatus = 'running' | 'stopped'

export interface VmDesktopRuntimeSession {
  sessionId: string
  status: VmDesktopRuntimeStatus
  definition: ExecutionTargetDefinition
  launchedAt: number
  stoppedAt?: number
  runtimeHandle?: string
}

export interface VmDesktopLaunchInput {
  targetId?: string
  label?: string
  providerId?: string
  domains?: string[]
  blockedDomains?: string[]
  allowPrivateNetwork?: boolean
  persistent?: boolean
  priority?: number
  vmImageRef?: string
  vmTemplateId?: string
  computeProfile?: string
  homeMount?: HomeMountPolicy
  profileSync?: ProfileSyncPolicy
  artifactTransfer?: ArtifactTransferPolicy
  metadata?: Record<string, unknown>
  now?: number
}

export interface VmDesktopLauncher {
  launch(definition: ExecutionTargetDefinition): Promise<{ runtimeHandle?: string }>
  stop?(session: VmDesktopRuntimeSession): Promise<void>
}

export interface VmDesktopRuntimeOptions {
  providerId?: string
  now?: () => number
  idFactory?: () => string
  launcher?: VmDesktopLauncher
}

export class VmDesktopTargetRuntime {
  private readonly sessions = new Map<string, VmDesktopRuntimeSession>()
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly providerId: string

  constructor(private readonly options: VmDesktopRuntimeOptions = {}) {
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomLocalId
    this.providerId = options.providerId ?? 'telegraph-vm-desktop'
  }

  listSessions(): VmDesktopRuntimeSession[] {
    return Array.from(this.sessions.values()).map(session => structuredClone(session))
  }

  listTargets(): ExecutionTargetDefinition[] {
    return this.listSessions()
      .filter(session => session.status === 'running')
      .map(session => structuredClone(session.definition))
  }

  async launch(input: VmDesktopLaunchInput = {}): Promise<VmDesktopRuntimeSession> {
    const now = input.now ?? this.now()
    const definition = createVmDesktopTargetDefinition(input, {
      providerId: input.providerId ?? this.providerId,
      idFactory: this.idFactory,
    })
    assertLaunchableVmDesktopTarget(definition)

    const launchResult = await this.options.launcher?.launch(definition)
    const session: VmDesktopRuntimeSession = {
      sessionId: `vm-desktop-session-${this.idFactory()}`,
      status: 'running',
      definition,
      launchedAt: now,
      runtimeHandle: launchResult?.runtimeHandle,
    }
    this.sessions.set(session.sessionId, session)
    return structuredClone(session)
  }

  async stop(sessionId: string, now = this.now()): Promise<VmDesktopRuntimeSession | null> {
    const current = this.sessions.get(sessionId)
    if (!current) return null
    if (current.status === 'stopped') return structuredClone(current)

    await this.options.launcher?.stop?.(structuredClone(current))
    const stopped: VmDesktopRuntimeSession = {
      ...current,
      status: 'stopped',
      stoppedAt: now,
    }
    this.sessions.set(sessionId, stopped)
    return structuredClone(stopped)
  }

  selectTarget(input: { domains?: string[] } = {}): ExecutionTargetDefinition | null {
    return selectExecutionTarget(this.listTargets(), {
      requestedKind: 'vm',
      internetAutomation: true,
      domains: input.domains,
    }).target
  }
}

export function createVmDesktopTargetDefinition(
  input: VmDesktopLaunchInput = {},
  options: { providerId?: string; idFactory?: () => string } = {},
): ExecutionTargetDefinition {
  const targetId = input.targetId ?? `vm-desktop-${options.idFactory?.() ?? randomLocalId()}`
  return {
    target: {
      targetId,
      kind: 'vm',
      label: input.label ?? 'VM Desktop',
      scope: {
        includeDomains: input.domains,
        excludeDomains: input.blockedDomains,
      },
    },
    trustLevel: 'managed-vm',
    providerId: input.providerId ?? options.providerId ?? 'telegraph-vm-desktop',
    enabled: true,
    persistent: input.persistent ?? false,
    priority: input.priority ?? 0,
    networkPolicy: vmDesktopNetworkPolicy(input),
    profileSync: input.profileSync ?? {
      mode: 'none',
      homeMount: input.homeMount ?? 'none',
    },
    artifactTransfer: input.artifactTransfer ?? {
      exportMode: 'explicit-approval',
      importMode: 'explicit-approval',
    },
    metadata: {
      runtime: 'vm-desktop',
      vmImageRef: input.vmImageRef,
      vmTemplateId: input.vmTemplateId,
      computeProfile: input.computeProfile,
      ...input.metadata,
    },
  }
}

export function assertLaunchableVmDesktopTarget(definition: ExecutionTargetDefinition): void {
  const errors = validateLaunchableVmDesktopTarget(definition)
  if (errors.length > 0) throw new Error(errors.join('; '))
}

export function validateLaunchableVmDesktopTarget(definition: ExecutionTargetDefinition): string[] {
  const errors = validateExecutionTargetDefinition(definition)
  if (definition.target.kind !== 'vm') {
    errors.push(`VM desktop runtime requires target kind "vm", got "${definition.target.kind}"`)
  }
  if (definition.trustLevel !== 'managed-vm') {
    errors.push(`VM desktop runtime requires trust level "managed-vm", got "${definition.trustLevel}"`)
  }
  if (definition.profileSync.homeMount === 'selected-paths-readwrite') {
    errors.push('VM desktop runtime cannot mount user home paths read-write by default')
  }
  if (definition.artifactTransfer.exportMode === 'workspace-scoped' && definition.artifactTransfer.importMode === 'workspace-scoped') {
    errors.push('VM desktop runtime cannot enable bidirectional workspace-scoped artifact transfer by default')
  }
  return errors
}

function vmDesktopNetworkPolicy(input: VmDesktopLaunchInput): DomainNetworkPolicy {
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
