import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentEvent } from '@/packages/agent-protocol'
import { PermissionBroker } from '../PermissionBroker'
import type { PermissionBrokerRequestContext } from '../PermissionBroker'
import {
  PermissionedNodeFilesystemCapability,
  PermissionedNodePatchCapability,
  PermissionedNodeProcessCapability,
} from '../node'
import { describe, expect, it } from 'vitest'

const baseContext: PermissionBrokerRequestContext = {
  runId: 'run-node-capability',
  sessionId: 'session-node-capability',
  pageletId: 'coding',
  pageletKind: 'coding',
}

describe('node integration capabilities', () => {
  it('executes shell commands only after PermissionBroker approval and emits tool events', async () => {
    const events: AgentEvent[] = []
    const command = process.execPath
    const emit = (event: AgentEvent) => { events.push(event); }
    const capability = new PermissionedNodeProcessCapability({
      broker: new PermissionBroker({ emit }),
      context: {
        ...baseContext,
        taskProfile: { kind: 'shell-automation', commands: [command], cwdPolicy: 'workspace' },
        workspacePolicy: {
          shell: {
            allowedCommands: [command],
            autoGrantUpToRisk: 'low',
            maxRisk: 'medium',
          },
        },
      },
      emit,
    })

    const result = await capability.exec(command, ['-e', 'process.stdout.write("ok")'], {
      permission: { type: 'shell', risk: 'low' },
      timeoutMs: 5_000,
    })

    expect(result).toMatchObject({ stdout: 'ok', stderr: '', code: 0 })
    expect(events.map(event => event.type)).toEqual([
      'permission_requested',
      'permission_resolved',
      'tool_call',
      'tool_result',
    ])
  })

  it('denies shell commands outside the active profile', async () => {
    const capability = new PermissionedNodeProcessCapability({
      broker: new PermissionBroker(),
      context: {
        ...baseContext,
        taskProfile: { kind: 'default' },
      },
    })

    await expect(capability.exec(process.execPath, ['-e', ''], {
      permission: { type: 'shell', risk: 'low' },
    })).rejects.toThrow('Shell execution requires')
  })

  it('reads and writes workspace files through filesystem permission checks', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telegraph-capability-'))
    const file = join(dir, 'note.txt')
    const events: AgentEvent[] = []
    const emit = (event: AgentEvent) => { events.push(event); }
    const capability = new PermissionedNodeFilesystemCapability({
      broker: new PermissionBroker({
        prompt: () => true,
        emit,
      }),
      context: {
        ...baseContext,
        taskProfile: {
          kind: 'coding-edit',
          scopes: ['repo:read', 'repo:write'],
          patchPolicy: 'apply-after-confirm',
        },
      },
      allowedRoots: [dir],
      emit,
    })

    try {
      await writeFile(file, 'before', 'utf8')
      expect(await capability.readText(file)).toBe('before')
      await capability.writeText(file, 'after')
      expect(await readFile(file, 'utf8')).toBe('after')
      expect(events.map(event => event.type)).toEqual([
        'permission_requested',
        'permission_resolved',
        'runtime_log',
        'permission_requested',
        'permission_resolved',
        'runtime_log',
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('previews and applies structured patches through filesystem write permission', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telegraph-patch-capability-'))
    const updateFile = join(dir, 'update.txt')
    const addFile = join(dir, 'nested', 'add.txt')
    const deleteFile = join(dir, 'delete.txt')
    const events: AgentEvent[] = []
    const emit = (event: AgentEvent) => { events.push(event); }
    const capability = new PermissionedNodePatchCapability({
      broker: new PermissionBroker({
        prompt: () => true,
        emit,
      }),
      context: {
        ...baseContext,
        taskProfile: {
          kind: 'coding-edit',
          scopes: ['repo:read', 'repo:write'],
          patchPolicy: 'apply-after-confirm',
        },
      },
      allowedRoots: [dir],
      emit,
    })

    try {
      await writeFile(updateFile, 'before', 'utf8')
      await writeFile(deleteFile, 'bye', 'utf8')

      const preview = await capability.preview([
        { kind: 'update', path: updateFile, expectedOriginal: 'before', content: 'after' },
        { kind: 'add', path: addFile, content: 'new' },
        { kind: 'delete', path: deleteFile },
      ])

      expect(preview.summary).toEqual({ adds: 1, updates: 1, deletes: 1 })

      const result = await capability.apply(preview.operations)

      expect(result.applied).toBe(true)
      expect(await readFile(updateFile, 'utf8')).toBe('after')
      expect(await readFile(addFile, 'utf8')).toBe('new')
      await expect(readFile(deleteFile, 'utf8')).rejects.toThrow()
      expect(events.map(event => event.type)).toEqual([
        'tool_call',
        'permission_requested',
        'permission_resolved',
        'permission_requested',
        'permission_resolved',
        'permission_requested',
        'permission_resolved',
        'tool_result',
      ])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
