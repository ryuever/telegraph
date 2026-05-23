import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  CreateSlackAppInstallationInput,
  CreateSlackDeviceBindingInput,
  CreateSlackUserBindingInput,
  CreateSlackWorkspaceBindingInput,
  SlackAppInstallation,
  SlackBindingStatus,
  SlackDeviceBinding,
  SlackGovernanceAction,
  SlackLifecycleEvent,
  SlackLifecycleRevokeResult,
  SlackTeamAuditEvent,
  SlackTeamGovernanceSnapshot,
  SlackTeamRole,
  SlackUserBinding,
  SlackWorkspaceBinding,
} from '@/apps/remote-control/application/common'

export interface SlackGovernanceAuthorizationInput {
  workspaceId?: string
  actorId: string
  userId?: string
  channelId?: string
  threadId?: string
  action: SlackGovernanceAction
}

export interface SlackGovernanceAuthorizationDecision {
  allowed: boolean
  reason?: string
  policyProfileId?: string
}

export class SlackTeamGovernance {
  private readonly installations = new Map<string, SlackAppInstallation>()
  private readonly workspaces = new Map<string, SlackWorkspaceBinding>()
  private readonly users = new Map<string, SlackUserBinding>()
  private readonly devices = new Map<string, SlackDeviceBinding>()
  private readonly auditEvents: SlackTeamAuditEvent[] = []

  constructor(snapshot: Partial<SlackTeamGovernanceSnapshot> = {}) {
    for (const installation of snapshot.installations ?? []) {
      this.installations.set(installation.installationId, structuredClone(installation))
    }
    for (const workspace of snapshot.workspaces ?? []) {
      this.workspaces.set(workspace.workspaceId, structuredClone(workspace))
    }
    for (const user of snapshot.users ?? []) {
      this.users.set(userKey(user.workspaceId, user.userId), structuredClone(user))
    }
    for (const device of snapshot.devices ?? []) {
      this.devices.set(device.bindingId, structuredClone(device))
    }
    for (const event of snapshot.auditEvents ?? []) {
      this.auditEvents.push(structuredClone(event))
    }
  }

  static empty(): SlackTeamGovernance {
    return new SlackTeamGovernance()
  }

  replaceSnapshot(snapshot: Partial<SlackTeamGovernanceSnapshot>): void {
    this.installations.clear()
    this.workspaces.clear()
    this.users.clear()
    this.devices.clear()
    this.auditEvents.length = 0
    for (const installation of snapshot.installations ?? []) {
      this.installations.set(installation.installationId, structuredClone(installation))
    }
    for (const workspace of snapshot.workspaces ?? []) {
      this.workspaces.set(workspace.workspaceId, structuredClone(workspace))
    }
    for (const user of snapshot.users ?? []) {
      this.users.set(userKey(user.workspaceId, user.userId), structuredClone(user))
    }
    for (const device of snapshot.devices ?? []) {
      this.devices.set(device.bindingId, structuredClone(device))
    }
    for (const event of snapshot.auditEvents ?? []) {
      this.auditEvents.push(structuredClone(event))
    }
  }

  authorize(input: SlackGovernanceAuthorizationInput): SlackGovernanceAuthorizationDecision {
    const workspaceDecision = this.authorizeWorkspace(input.workspaceId)
    if (!workspaceDecision.allowed) return workspaceDecision

    const userDecision = this.authorizeUser(input.workspaceId, input.userId)
    if (!userDecision.allowed) return userDecision

    const roleDecision = this.authorizeRole(input.action, input.workspaceId, input.userId)
    if (!roleDecision.allowed) return roleDecision

    return {
      allowed: true,
      policyProfileId: roleDecision.policyProfileId ?? userDecision.policyProfileId ?? workspaceDecision.policyProfileId,
    }
  }

  recordAuditEvent(input: Omit<SlackTeamAuditEvent, 'auditId' | 'ts'> & { now?: number }): SlackTeamAuditEvent {
    const now = input.now ?? Date.now()
    const event: SlackTeamAuditEvent = {
      auditId: `slack-audit-${now.toString(36)}-${String(this.auditEvents.length + 1)}`,
      ts: now,
      action: input.action,
      status: input.status,
      workspaceId: input.workspaceId,
      actorId: input.actorId,
      channelId: input.channelId,
      threadId: input.threadId,
      policyProfileId: input.policyProfileId,
      approvalId: input.approvalId,
      reason: input.reason,
    }
    this.auditEvents.push(event)
    return structuredClone(event)
  }

  snapshot(): SlackTeamGovernanceSnapshot {
    return {
      installations: Array.from(this.installations.values()).map(item => structuredClone(item)),
      workspaces: Array.from(this.workspaces.values()).map(item => structuredClone(item)),
      users: Array.from(this.users.values()).map(item => structuredClone(item)),
      devices: Array.from(this.devices.values()).map(item => structuredClone(item)),
      auditEvents: this.auditEvents.map(item => structuredClone(item)),
    }
  }

  listAuditEvents(): SlackTeamAuditEvent[] {
    return this.auditEvents.map(item => structuredClone(item))
  }

  listWorkspaceBindings(): SlackWorkspaceBinding[] {
    return Array.from(this.workspaces.values()).map(item => structuredClone(item))
  }

  listAppInstallations(): SlackAppInstallation[] {
    return Array.from(this.installations.values()).map(item => structuredClone(item))
  }

  createAppInstallation(input: CreateSlackAppInstallationInput): SlackAppInstallation {
    const now = input.now ?? Date.now()
    const installationId = input.installationId ?? this.installationIdForWorkspace(input.workspaceId)
    const current = this.installations.get(installationId)
    const installation: SlackAppInstallation = {
      installationId,
      workspaceId: input.workspaceId,
      teamDomain: input.teamDomain ?? current?.teamDomain,
      enterpriseId: input.enterpriseId ?? current?.enterpriseId,
      appId: input.appId ?? current?.appId,
      botUserId: input.botUserId ?? current?.botUserId,
      botTokenRef: input.botTokenRef ?? current?.botTokenRef,
      userTokenRef: input.userTokenRef ?? current?.userTokenRef,
      scopes: uniqueStrings(input.scopes ?? current?.scopes ?? []),
      status: 'active',
      installedByUserId: input.installedByUserId ?? current?.installedByUserId,
      policyProfileId: input.policyProfileId ?? current?.policyProfileId,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    }
    this.installations.set(installationId, installation)
    this.upsertWorkspaceBinding({
      workspaceId: input.workspaceId,
      teamDomain: input.teamDomain,
      policyProfileId: input.policyProfileId,
      now,
    })
    if (input.installedByUserId) {
      this.upsertUserBinding({
        workspaceId: input.workspaceId,
        userId: input.installedByUserId,
        role: input.installerRole ?? 'admin',
        policyProfileId: input.policyProfileId,
        now,
      })
    }
    this.recordAuditEvent({
      action: 'app_installed',
      status: 'accepted',
      workspaceId: input.workspaceId,
      actorId: input.installedByUserId ? `slack:${input.installedByUserId}` : 'slack:oauth',
      policyProfileId: input.policyProfileId,
      reason: `Slack app installation "${installationId}" activated.`,
      now,
    })
    return structuredClone(installation)
  }

  revokeAppInstallation(installationId: string, now = Date.now()): SlackAppInstallation | null {
    const current = this.installations.get(installationId)
    if (!current) return null
    const next: SlackAppInstallation = {
      ...current,
      status: 'revoked',
      updatedAt: now,
      revokedAt: now,
    }
    this.installations.set(installationId, next)
    this.applyLifecycleEvent({
      kind: 'app_uninstalled',
      workspaceId: current.workspaceId,
      actorId: current.installedByUserId ? `slack:${current.installedByUserId}` : 'slack:oauth',
      reason: `Slack app installation "${installationId}" revoked.`,
      now,
    })
    return structuredClone(next)
  }

  upsertWorkspaceBinding(input: CreateSlackWorkspaceBindingInput): SlackWorkspaceBinding {
    const now = input.now ?? Date.now()
    const current = this.workspaces.get(input.workspaceId)
    const binding: SlackWorkspaceBinding = {
      workspaceId: input.workspaceId,
      teamDomain: input.teamDomain ?? current?.teamDomain,
      status: 'active',
      policyProfileId: input.policyProfileId ?? current?.policyProfileId,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    }
    this.workspaces.set(input.workspaceId, binding)
    return structuredClone(binding)
  }

  revokeWorkspaceBinding(workspaceId: string, now = Date.now()): SlackWorkspaceBinding | null {
    const current = this.workspaces.get(workspaceId)
    if (!current) return null
    const next: SlackWorkspaceBinding = {
      ...current,
      status: 'revoked',
      updatedAt: now,
      revokedAt: now,
    }
    this.workspaces.set(workspaceId, next)
    return structuredClone(next)
  }

  listUserBindings(): SlackUserBinding[] {
    return Array.from(this.users.values()).map(item => structuredClone(item))
  }

  upsertUserBinding(input: CreateSlackUserBindingInput): SlackUserBinding {
    const now = input.now ?? Date.now()
    const key = userKey(input.workspaceId, input.userId)
    const current = this.users.get(key)
    const binding: SlackUserBinding = {
      workspaceId: input.workspaceId,
      userId: input.userId,
      actorId: input.actorId ?? current?.actorId ?? `slack:${input.userId}`,
      status: 'active',
      role: input.role ?? current?.role ?? 'member',
      policyProfileId: input.policyProfileId ?? current?.policyProfileId,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    }
    this.users.set(key, binding)
    return structuredClone(binding)
  }

  revokeUserBinding(workspaceId: string, userId: string, now = Date.now()): SlackUserBinding | null {
    const key = userKey(workspaceId, userId)
    const current = this.users.get(key)
    if (!current) return null
    const next: SlackUserBinding = {
      ...current,
      status: 'revoked',
      updatedAt: now,
      revokedAt: now,
    }
    this.users.set(key, next)
    return structuredClone(next)
  }

  listDeviceBindings(): SlackDeviceBinding[] {
    return Array.from(this.devices.values()).map(item => structuredClone(item))
  }

  upsertDeviceBinding(input: CreateSlackDeviceBindingInput): SlackDeviceBinding {
    const now = input.now ?? Date.now()
    const bindingId = input.bindingId ?? deviceBindingId(input.workspaceId, input.userId, input.deviceId)
    const current = this.devices.get(bindingId)
    const binding: SlackDeviceBinding = {
      bindingId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      deviceId: input.deviceId,
      actorId: input.actorId ?? current?.actorId ?? `slack:${input.userId}`,
      label: input.label ?? current?.label,
      status: 'active',
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      expiresAt: input.expiresAt ?? current?.expiresAt,
    }
    this.devices.set(bindingId, binding)
    this.recordAuditEvent({
      action: 'device_bound',
      status: 'accepted',
      workspaceId: input.workspaceId,
      actorId: binding.actorId,
      reason: `Slack device "${input.deviceId}" bound to user "${input.userId}".`,
      now,
    })
    return structuredClone(binding)
  }

  revokeDeviceBinding(bindingId: string, now = Date.now()): SlackDeviceBinding | null {
    const current = this.devices.get(bindingId)
    if (!current) return null
    const next: SlackDeviceBinding = {
      ...current,
      status: 'revoked',
      updatedAt: now,
      revokedAt: now,
    }
    this.devices.set(bindingId, next)
    this.recordAuditEvent({
      action: 'device_revoked',
      status: 'accepted',
      workspaceId: next.workspaceId,
      actorId: next.actorId,
      reason: `Slack device binding "${bindingId}" revoked.`,
      now,
    })
    return structuredClone(next)
  }

  applyLifecycleEvent(event: SlackLifecycleEvent): SlackLifecycleRevokeResult {
    const now = event.now ?? Date.now()
    const actorId = event.actorId ?? 'slack:lifecycle'
    const userIds = uniqueStrings(event.userIds ?? [])
    const shouldRevokeWorkspace =
      event.kind === 'app_uninstalled' ||
      (event.kind === 'tokens_revoked' && userIds.length === 0)

    const revokedWorkspace = shouldRevokeWorkspace
      ? this.revokeWorkspaceBinding(event.workspaceId, now)
      : null
    if (shouldRevokeWorkspace) {
      this.revokeWorkspaceInstallations(event.workspaceId, now)
    }
    const revokedUsers = shouldRevokeWorkspace
      ? this.revokeWorkspaceUsers(event.workspaceId, now)
      : userIds
        .map(userId => this.revokeUserBinding(event.workspaceId, userId, now))
        .filter((binding): binding is SlackUserBinding => binding !== null)
    const revokedDevices = shouldRevokeWorkspace
      ? this.revokeWorkspaceDevices(event.workspaceId, now)
      : this.revokeUserDevices(event.workspaceId, userIds, now)

    const auditEvent = this.recordAuditEvent({
      action: event.kind,
      status: 'accepted',
      workspaceId: event.workspaceId,
      actorId,
      reason: event.reason ?? lifecycleReason(event.kind, userIds, shouldRevokeWorkspace),
      now,
    })

    return {
      kind: event.kind,
      workspaceId: event.workspaceId,
      revokedWorkspace,
      revokedUsers,
      revokedDevices,
      auditEvent,
    }
  }

  private authorizeWorkspace(workspaceId: string | undefined): SlackGovernanceAuthorizationDecision {
    if (this.workspaces.size === 0) return { allowed: true }
    if (!workspaceId) {
      return {
        allowed: false,
        reason: 'Slack workspace binding is required.',
      }
    }
    const binding = this.workspaces.get(workspaceId)
    if (!binding) {
      return {
        allowed: false,
        reason: `Slack workspace "${workspaceId}" is not bound.`,
      }
    }
    if (binding.status !== 'active') {
      return {
        allowed: false,
        reason: `Slack workspace "${workspaceId}" is ${binding.status}.`,
      }
    }
    return {
      allowed: true,
      policyProfileId: binding.policyProfileId,
    }
  }

  private authorizeUser(
    workspaceId: string | undefined,
    userId: string | undefined,
  ): SlackGovernanceAuthorizationDecision {
    if (this.users.size === 0) return { allowed: true }
    if (!workspaceId || !userId) {
      return {
        allowed: false,
        reason: 'Slack user binding is required.',
      }
    }
    const binding = this.users.get(userKey(workspaceId, userId))
    if (!binding) {
      return {
        allowed: false,
        reason: `Slack user "${userId}" is not bound in workspace "${workspaceId}".`,
      }
    }
    if (binding.status !== 'active') {
      return {
        allowed: false,
        reason: `Slack user "${userId}" is ${binding.status}.`,
      }
    }
    return {
      allowed: true,
      policyProfileId: binding.policyProfileId,
    }
  }

  private authorizeRole(
    action: SlackGovernanceAction,
    workspaceId: string | undefined,
    userId: string | undefined,
  ): SlackGovernanceAuthorizationDecision {
    if (!workspaceId || !userId) return { allowed: true }
    const binding = this.users.get(userKey(workspaceId, userId))
    if (!binding) return { allowed: true }

    if ((action === 'approve' || action === 'deny' || action === 'block_approve' || action === 'block_deny') &&
      binding.role === 'member') {
      return {
        allowed: false,
        reason: `Slack user "${userId}" requires operator or admin role for approval decisions.`,
      }
    }
    return {
      allowed: true,
      policyProfileId: binding.policyProfileId,
    }
  }

  private revokeWorkspaceUsers(workspaceId: string, now: number): SlackUserBinding[] {
    const revoked: SlackUserBinding[] = []
    for (const binding of this.users.values()) {
      if (binding.workspaceId !== workspaceId || binding.status !== 'active') continue
      const next = this.revokeUserBinding(binding.workspaceId, binding.userId, now)
      if (next) revoked.push(next)
    }
    return revoked
  }

  private revokeWorkspaceDevices(workspaceId: string, now: number): SlackDeviceBinding[] {
    const revoked: SlackDeviceBinding[] = []
    for (const binding of this.devices.values()) {
      if (binding.workspaceId !== workspaceId || binding.status !== 'active') continue
      const next = this.revokeDeviceBinding(binding.bindingId, now)
      if (next) revoked.push(next)
    }
    return revoked
  }

  private revokeUserDevices(workspaceId: string, userIds: string[], now: number): SlackDeviceBinding[] {
    const users = new Set(userIds)
    const revoked: SlackDeviceBinding[] = []
    for (const binding of this.devices.values()) {
      if (binding.workspaceId !== workspaceId || !users.has(binding.userId) || binding.status !== 'active') continue
      const next = this.revokeDeviceBinding(binding.bindingId, now)
      if (next) revoked.push(next)
    }
    return revoked
  }

  private revokeWorkspaceInstallations(workspaceId: string, now: number): void {
    for (const installation of this.installations.values()) {
      if (installation.workspaceId !== workspaceId || installation.status !== 'active') continue
      this.installations.set(installation.installationId, {
        ...installation,
        status: 'revoked',
        updatedAt: now,
        revokedAt: now,
      })
    }
  }

  private installationIdForWorkspace(workspaceId: string): string {
    for (const installation of this.installations.values()) {
      if (installation.workspaceId === workspaceId) return installation.installationId
    }
    return `slack-install-${workspaceId}`
  }
}

export class FileSlackTeamGovernanceRepository {
  private readonly filePath: string

  constructor(dataDir = join(process.cwd(), '.telegraph', 'remote-control')) {
    this.filePath = join(dataDir, 'slack-team-governance.json')
  }

  async load(): Promise<SlackTeamGovernanceSnapshot> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      return isSlackTeamGovernanceSnapshot(parsed)
        ? normalizeSlackTeamGovernanceSnapshot(parsed)
        : emptySlackTeamGovernanceSnapshot()
    } catch (error) {
      if (isNotFound(error)) return emptySlackTeamGovernanceSnapshot()
      throw error
    }
  }

  async save(snapshot: SlackTeamGovernanceSnapshot): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
  }
}

export function emptySlackTeamGovernanceSnapshot(): SlackTeamGovernanceSnapshot {
  return {
    installations: [],
    workspaces: [],
    users: [],
    devices: [],
    auditEvents: [],
  }
}

function userKey(workspaceId: string, userId: string): string {
  return `${workspaceId}:${userId}`
}

function deviceBindingId(workspaceId: string, userId: string, deviceId: string): string {
  return `slack-device-${workspaceId}-${userId}-${deviceId}`
}

function isSlackTeamGovernanceSnapshot(value: unknown): value is SlackTeamGovernanceSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<SlackTeamGovernanceSnapshot>
  return (record.installations === undefined ||
    (Array.isArray(record.installations) && record.installations.every(isSlackAppInstallation))) &&
    Array.isArray(record.workspaces) &&
    record.workspaces.every(isSlackWorkspaceBinding) &&
    Array.isArray(record.users) &&
    record.users.every(isSlackUserBinding) &&
    (record.devices === undefined ||
      (Array.isArray(record.devices) && record.devices.every(isSlackDeviceBinding))) &&
    Array.isArray(record.auditEvents) &&
    record.auditEvents.every(isSlackTeamAuditEvent)
}

function normalizeSlackTeamGovernanceSnapshot(
  snapshot: Partial<SlackTeamGovernanceSnapshot>,
): SlackTeamGovernanceSnapshot {
  return {
    installations: snapshot.installations ?? [],
    workspaces: snapshot.workspaces ?? [],
    users: snapshot.users ?? [],
    devices: snapshot.devices ?? [],
    auditEvents: snapshot.auditEvents ?? [],
  }
}

function isSlackAppInstallation(value: unknown): value is SlackAppInstallation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<SlackAppInstallation>
  return typeof record.installationId === 'string' &&
    typeof record.workspaceId === 'string' &&
    Array.isArray(record.scopes) &&
    record.scopes.every(scope => typeof scope === 'string') &&
    isSlackBindingStatus(record.status) &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
}

function isSlackWorkspaceBinding(value: unknown): value is SlackWorkspaceBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<SlackWorkspaceBinding>
  return typeof record.workspaceId === 'string' &&
    isSlackBindingStatus(record.status) &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
}

function isSlackUserBinding(value: unknown): value is SlackUserBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<SlackUserBinding>
  return typeof record.workspaceId === 'string' &&
    typeof record.userId === 'string' &&
    typeof record.actorId === 'string' &&
    isSlackBindingStatus(record.status) &&
    isSlackTeamRole(record.role) &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
}

function isSlackDeviceBinding(value: unknown): value is SlackDeviceBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<SlackDeviceBinding>
  return typeof record.bindingId === 'string' &&
    typeof record.workspaceId === 'string' &&
    typeof record.userId === 'string' &&
    typeof record.deviceId === 'string' &&
    typeof record.actorId === 'string' &&
    isSlackBindingStatus(record.status) &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
}

function isSlackTeamAuditEvent(value: unknown): value is SlackTeamAuditEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<SlackTeamAuditEvent>
  return typeof record.auditId === 'string' &&
    typeof record.ts === 'number' &&
    isSlackGovernanceAction(record.action) &&
    (record.status === 'accepted' || record.status === 'rejected') &&
    typeof record.actorId === 'string'
}

function isSlackBindingStatus(value: unknown): value is SlackBindingStatus {
  return value === 'active' || value === 'revoked'
}

function isSlackTeamRole(value: unknown): value is SlackTeamRole {
  return value === 'member' || value === 'operator' || value === 'admin'
}

function isSlackGovernanceAction(value: unknown): value is SlackGovernanceAction {
  return value === 'ask' ||
    value === 'runs' ||
    value === 'approve' ||
    value === 'deny' ||
    value === 'block_approve' ||
    value === 'block_deny' ||
    value === 'app_installed' ||
    value === 'device_bound' ||
    value === 'device_revoked' ||
    value === 'tokens_revoked' ||
    value === 'user_left_workspace' ||
    value === 'app_uninstalled'
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(value => value.length > 0)))
}

function lifecycleReason(
  kind: SlackLifecycleEvent['kind'],
  userIds: string[],
  revokedWorkspace: boolean,
): string {
  if (kind === 'app_uninstalled') return 'Slack app was uninstalled; workspace access revoked.'
  if (kind === 'tokens_revoked' && revokedWorkspace) {
    return 'Slack token revoke did not include users; workspace access revoked.'
  }
  if (kind === 'tokens_revoked') {
    return `Slack token revoke affected users: ${userIds.join(', ')}.`
  }
  return `Slack users left workspace: ${userIds.join(', ')}.`
}

function isNotFound(error: unknown): boolean {
  return !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
}
