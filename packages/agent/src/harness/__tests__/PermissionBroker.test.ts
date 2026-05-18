import type {
  AgentEvent,
  PermissionRequest,
} from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import {
  PermissionBroker,
  type PermissionBrokerRequestContext,
  type PermissionDecision,
} from '../PermissionBroker'

const baseContext: PermissionBrokerRequestContext = {
  runId: 'run-permission-test',
  sessionId: 'session-permission-test',
  pageletId: 'chat',
  pageletKind: 'chat',
  taskProfile: { kind: 'default' },
}

describe('PermissionBroker', () => {
  it('grants readonly workspace filesystem access through readonly profile', () => {
    const broker = new PermissionBroker()
    const decision = broker.evaluatePermission(filesystemPermission('workspace', 'read'), {
      ...baseContext,
      taskProfile: { kind: 'readonly-workspace', scopes: ['repo:read'] },
    })

    expect(decision).toMatchObject({
      granted: true,
      source: 'profile',
    })
  })

  it('denies readonly workspace filesystem access when the profile lacks read scope', () => {
    const broker = new PermissionBroker()
    const decision = broker.evaluatePermission(filesystemPermission('workspace', 'read'), {
      ...baseContext,
      taskProfile: { kind: 'readonly-workspace', scopes: [] },
    })

    expect(decision).toMatchObject({
      granted: false,
      source: 'default-deny',
    })
  })

  it('requires user approval for workspace writes unless policy auto-grants them', async () => {
    const broker = new PermissionBroker({
      prompt: () => true,
    })

    const decision = await broker.requestPermission(filesystemPermission('workspace', 'write'), {
      ...baseContext,
      taskProfile: {
        kind: 'coding-edit',
        scopes: ['repo:read', 'repo:write'],
        patchPolicy: 'apply-after-confirm',
      },
    })

    expect(decision).toMatchObject({
      granted: true,
      source: 'user',
    })
  })

  it('denies shell execution without shell profile or explicit shell intent', () => {
    const broker = new PermissionBroker()
    const decision = broker.evaluatePermission({ type: 'shell', risk: 'low' }, baseContext)

    expect(decision).toMatchObject({
      granted: false,
      source: 'default-deny',
    })
    expect(decision.reason).toContain('Shell execution requires')
  })

  it('lets pagelet policy deny an integration before profile policy is considered', () => {
    const broker = new PermissionBroker()
    const decision = broker.evaluatePermission({ type: 'shell', risk: 'low' }, {
      ...baseContext,
      pageletPolicy: {
        deniedCapabilities: ['shell'],
      },
      taskProfile: {
        kind: 'shell-automation',
        commands: ['git'],
        cwdPolicy: 'workspace',
      },
      operation: {
        kind: 'shell.exec',
        command: 'git',
      },
    })

    expect(decision).toMatchObject({
      granted: false,
      source: 'default-deny',
    })
    expect(decision.reason).toContain('Pagelet')
  })

  it('auto-grants low-risk shell commands when profile and workspace allowlists match', () => {
    const broker = new PermissionBroker()
    const decision = broker.evaluatePermission({ type: 'shell', risk: 'low' }, {
      ...baseContext,
      taskProfile: {
        kind: 'shell-automation',
        commands: ['git'],
        cwdPolicy: 'workspace',
      },
      workspacePolicy: {
        shell: {
          allowedCommands: ['git'],
          autoGrantUpToRisk: 'low',
          maxRisk: 'medium',
        },
      },
      operation: {
        kind: 'shell.exec',
        command: 'git',
      },
    })

    expect(decision).toMatchObject({
      granted: true,
      source: 'workspace-policy',
    })
  })

  it('does not reuse a shell decision for a different command in the same run', async () => {
    let promptCount = 0
    const broker = new PermissionBroker({
      prompt: () => {
        promptCount += 1
        return true
      },
    })
    const context: PermissionBrokerRequestContext = {
      ...baseContext,
      taskProfile: {
        kind: 'shell-automation',
        cwdPolicy: 'workspace',
      },
      workspacePolicy: {
        shell: {
          maxRisk: 'medium',
        },
      },
    }

    const first = await broker.requestPermission({ type: 'shell', risk: 'medium' }, {
      ...context,
      operation: { kind: 'shell.exec', command: 'git' },
    })
    const second = await broker.requestPermission({ type: 'shell', risk: 'medium' }, {
      ...context,
      operation: { kind: 'shell.exec', command: 'npm' },
    })

    expect(first.granted).toBe(true)
    expect(second.granted).toBe(true)
    expect(promptCount).toBe(2)
  })

  it('reuses an identical permission decision only inside the same run', async () => {
    let promptCount = 0
    const broker = new PermissionBroker({
      prompt: () => {
        promptCount += 1
        return true
      },
    })
    const context: PermissionBrokerRequestContext = {
      ...baseContext,
      taskProfile: {
        kind: 'shell-automation',
        cwdPolicy: 'workspace',
      },
      workspacePolicy: {
        shell: {
          maxRisk: 'medium',
        },
      },
      operation: { kind: 'shell.exec', command: 'git' },
    }

    await broker.requestPermission({ type: 'shell', risk: 'medium' }, context)
    const cached = await broker.requestPermission({ type: 'shell', risk: 'medium' }, context)
    const nextRun = await broker.requestPermission({ type: 'shell', risk: 'medium' }, {
      ...context,
      runId: 'run-permission-test-next',
    })

    expect(cached).toMatchObject({
      granted: true,
      source: 'run-cache',
    })
    expect(nextRun).toMatchObject({
      granted: true,
      source: 'user',
    })
    expect(promptCount).toBe(2)
  })

  it('grants network access only for explicit intent and allowed hosts', () => {
    const broker = new PermissionBroker()
    const decision = broker.evaluatePermission({ type: 'network', hosts: ['api.example.com'] }, {
      ...baseContext,
      userIntent: {
        requestedCapabilities: ['network'],
      },
      workspacePolicy: {
        network: {
          allowedHosts: ['*.example.com'],
        },
      },
    })

    expect(decision).toMatchObject({
      granted: true,
      source: 'workspace-policy',
    })
  })

  it('emits permission_requested and permission_resolved without waiting on trace failures', async () => {
    const events: AgentEvent[] = []
    const broker = new PermissionBroker({
      now: () => 123,
      emit: (event) => {
        events.push(event)
        throw new Error('trace failure')
      },
    })

    const decision = await broker.requestPermission(filesystemPermission('workspace', 'read'), {
      ...baseContext,
      taskProfile: { kind: 'readonly-workspace', scopes: ['repo:read'] },
    })

    expect(decision.granted).toBe(true)
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({
      type: 'permission_requested',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: baseContext.runId,
      ts: 123,
    })
    expect(events[1]).toMatchObject({
      type: 'permission_resolved',
      granted: true,
      runId: baseContext.runId,
      ts: 123,
    })
  })

  it('normalizes custom prompt decisions', async () => {
    const broker = new PermissionBroker({
      prompt: (): PermissionDecision => ({
        granted: false,
        source: 'profile',
        reason: 'Host policy asked user and they declined',
      }),
    })

    const decision = await broker.requestPermission(filesystemPermission('workspace', 'write'), {
      ...baseContext,
      taskProfile: {
        kind: 'coding-edit',
        scopes: ['repo:write'],
        patchPolicy: 'apply-after-confirm',
      },
    })

    expect(decision).toMatchObject({
      granted: false,
      source: 'user',
      reason: 'Host policy asked user and they declined',
    })
  })
})

function filesystemPermission(
  scope: Extract<PermissionRequest, { type: 'filesystem' }>['scope'],
  access: Extract<PermissionRequest, { type: 'filesystem' }>['access'],
): PermissionRequest {
  return {
    type: 'filesystem',
    scope,
    access,
  }
}
