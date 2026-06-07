import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import type { AgentEvent, PermissionRequest } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type {
  FilesystemCapability,
  PatchApplyResult,
  PatchCapability,
  PatchFileOperation,
  PatchPreview,
  ProcessCapability,
  ProcessExecResult,
} from '@/packages/agent-capabilities'
import type {
  PermissionBroker,
  PermissionBrokerRequestContext,
} from '../PermissionBroker'

export interface NodeCapabilityOptions {
  broker: PermissionBroker
  context: PermissionBrokerRequestContext
  emit?: (event: AgentEvent, context: PermissionBrokerRequestContext) => void | Promise<void>
  now?: () => number
}

export interface NodeProcessCapabilityOptions extends NodeCapabilityOptions {
  allowedCwdRoots?: string[]
  allowedEnvKeys?: string[]
  maxOutputBytes?: number
}

export class PermissionedNodeProcessCapability implements ProcessCapability {
  private readonly broker: PermissionBroker
  private readonly context: PermissionBrokerRequestContext
  private readonly emit?: NodeCapabilityOptions['emit']
  private readonly now: () => number
  private readonly allowedCwdRoots: string[]
  private readonly allowedEnvKeys?: Set<string>
  private readonly maxOutputBytes: number

  constructor(options: NodeProcessCapabilityOptions) {
    this.broker = options.broker
    this.context = options.context
    this.emit = options.emit
    this.now = options.now ?? Date.now
    this.allowedCwdRoots = (options.allowedCwdRoots ?? []).map(path => resolve(path))
    this.allowedEnvKeys = options.allowedEnvKeys ? new Set(options.allowedEnvKeys) : undefined
    this.maxOutputBytes = options.maxOutputBytes ?? 1024 * 1024
  }

  async exec(
    command: string,
    args: string[],
    options: Parameters<ProcessCapability['exec']>[2],
  ): Promise<ProcessExecResult> {
    const cwd = options.cwd ? resolve(options.cwd) : undefined
    this.assertAllowedCwd(cwd)
    const env = this.filterEnv(options.env)
    const permission = options.permission
    const callId = `process:${this.context.runId}:${String(this.now())}`
    const context = {
      ...this.context,
      operation: {
        kind: 'shell.exec' as const,
        command,
        cwd,
        envKeys: Object.keys(env ?? {}),
      },
    }

    const decision = await this.broker.requestPermission(permission, context)
    if (!decision.granted) {
      const error = new Error(decision.reason)
      this.emitToolError(callId, command, error)
      throw error
    }

    this.emitToolCall(callId, command, { command, args, cwd, timeoutMs: options.timeoutMs })

    try {
      const result = await spawnProcess(command, args, {
        cwd,
        env,
        timeoutMs: options.timeoutMs,
        maxOutputBytes: this.maxOutputBytes,
      })
      this.emitToolResult(callId, command, result)
      return result
    } catch (error) {
      this.emitToolError(callId, command, error)
      throw error
    }
  }

  private assertAllowedCwd(cwd: string | undefined): void {
    if (!cwd || this.allowedCwdRoots.length === 0) return
    if (!this.allowedCwdRoots.some(root => cwd === root || cwd.startsWith(`${root}/`))) {
      throw new Error(`cwd "${cwd}" is outside allowed roots`)
    }
  }

  private filterEnv(env: Record<string, string> | undefined): Record<string, string> | undefined {
    if (!env || !this.allowedEnvKeys) return env
    return Object.fromEntries(Object.entries(env).filter(([key]) => this.allowedEnvKeys?.has(key)))
  }

  private emitToolCall(callId: string, toolName: string, input: unknown): void {
    this.emitEvent({
      type: 'tool_call',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: 'telegraph-node-process-capability@0.0.0',
      origin: { framework: 'telegraph', runtimeId: 'node-process-capability' },
      runId: this.context.runId,
      callId,
      toolName,
      input,
      ts: this.now(),
    })
  }

  private emitToolResult(callId: string, toolName: string, output: unknown): void {
    this.emitEvent({
      type: 'tool_result',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: 'telegraph-node-process-capability@0.0.0',
      origin: { framework: 'telegraph', runtimeId: 'node-process-capability' },
      runId: this.context.runId,
      callId,
      toolName,
      output,
      ts: this.now(),
    })
  }

  private emitToolError(callId: string, toolName: string, error: unknown): void {
    this.emitEvent({
      type: 'tool_error',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: 'telegraph-node-process-capability@0.0.0',
      origin: { framework: 'telegraph', runtimeId: 'node-process-capability' },
      runId: this.context.runId,
      callId,
      toolName,
      error: {
        code: error instanceof Error ? error.name : 'process_exec_error',
        message: error instanceof Error ? error.message : String(error),
      },
      ts: this.now(),
    })
  }

  private emitEvent(event: AgentEvent): void {
    if (!this.emit) return
    try {
      void Promise.resolve(this.emit(event, this.context)).catch(() => {})
    } catch {
      // Capability trace is observability only; it must not block tool execution.
    }
  }
}

export interface NodeFilesystemCapabilityOptions extends NodeCapabilityOptions {
  allowedRoots?: string[]
}

export class PermissionedNodeFilesystemCapability implements FilesystemCapability {
  private readonly broker: PermissionBroker
  private readonly context: PermissionBrokerRequestContext
  private readonly emit?: NodeCapabilityOptions['emit']
  private readonly now: () => number
  private readonly allowedRoots: string[]

  constructor(options: NodeFilesystemCapabilityOptions) {
    this.broker = options.broker
    this.context = options.context
    this.emit = options.emit
    this.now = options.now ?? Date.now
    this.allowedRoots = (options.allowedRoots ?? []).map(path => resolve(path))
  }

  async readText(path: string): Promise<string> {
    const resolved = this.resolveAllowedPath(path)
    await this.requirePermission({ type: 'filesystem', scope: 'workspace', access: 'read' }, 'filesystem.read', resolved)
    const content = await readFile(resolved, 'utf8')
    this.emitRuntimeLog('debug', `read:${resolved}`, { path: resolved })
    return content
  }

  async writeText(path: string, content: string): Promise<void> {
    const resolved = this.resolveAllowedPath(path)
    await this.requirePermission({ type: 'filesystem', scope: 'workspace', access: 'write' }, 'filesystem.write', resolved)
    await writeFile(resolved, content, 'utf8')
    this.emitRuntimeLog('debug', `write:${resolved}`, { path: resolved, bytes: Buffer.byteLength(content) })
  }

  private resolveAllowedPath(path: string): string {
    const resolved = isAbsolute(path) ? resolve(path) : resolve(path)
    if (this.allowedRoots.length === 0) return resolved
    if (!this.allowedRoots.some(root => resolved === root || resolved.startsWith(`${root}/`))) {
      throw new Error(`path "${resolved}" is outside allowed roots`)
    }
    return resolved
  }

  private async requirePermission(
    permission: PermissionRequest,
    kind: 'filesystem.read' | 'filesystem.write',
    path: string,
  ): Promise<void> {
    const decision = await this.broker.requestPermission(permission, {
      ...this.context,
      operation: { kind, path },
    })
    if (!decision.granted) {
      throw new Error(decision.reason)
    }
  }

  private emitRuntimeLog(level: 'debug' | 'info' | 'warn' | 'error', message: string, raw?: unknown): void {
    if (!this.emit) return
    const event: AgentEvent = {
      type: 'runtime_log',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: 'telegraph-node-filesystem-capability@0.0.0',
      origin: { framework: 'telegraph', runtimeId: 'node-filesystem-capability' },
      runId: this.context.runId,
      level,
      message,
      raw,
      ts: this.now(),
    }
    try {
      void Promise.resolve(this.emit(event, this.context)).catch(() => {})
    } catch {
      // Capability trace is observability only; it must not block file IO.
    }
  }
}

export interface NodePatchCapabilityOptions extends NodeCapabilityOptions {
  allowedRoots?: string[]
}

export class PermissionedNodePatchCapability implements PatchCapability {
  private readonly broker: PermissionBroker
  private readonly context: PermissionBrokerRequestContext
  private readonly emit?: NodeCapabilityOptions['emit']
  private readonly now: () => number
  private readonly allowedRoots: string[]

  constructor(options: NodePatchCapabilityOptions) {
    this.broker = options.broker
    this.context = options.context
    this.emit = options.emit
    this.now = options.now ?? Date.now
    this.allowedRoots = (options.allowedRoots ?? []).map(path => resolve(path))
  }

  preview(operations: PatchFileOperation[]): Promise<PatchPreview> {
    const normalized = operations.map(operation => this.normalizeOperation(operation))
    return Promise.resolve({
      operations: normalized,
      summary: summarizePatch(normalized),
    })
  }

  async apply(operations: PatchFileOperation[]): Promise<PatchApplyResult> {
    const preview = await this.preview(operations)
    const callId = `patch:${this.context.runId}:${String(this.now())}`
    this.emitToolCall(callId, preview)

    try {
      for (const operation of preview.operations) {
        await this.requireWritePermission(operation.path)
        await this.applyOperation(operation)
      }

      const result: PatchApplyResult = {
        ...preview,
        applied: true,
      }
      this.emitToolResult(callId, result)
      return result
    } catch (error) {
      this.emitToolError(callId, error)
      throw error
    }
  }

  private normalizeOperation(operation: PatchFileOperation): PatchFileOperation {
    const path = this.resolveAllowedPath(operation.path)
    if (operation.kind !== 'delete' && typeof operation.content !== 'string') {
      throw new Error(`Patch operation "${operation.kind}" for "${path}" requires content`)
    }
    return {
      ...operation,
      path,
    }
  }

  private async applyOperation(operation: PatchFileOperation): Promise<void> {
    if (operation.expectedOriginal !== undefined) {
      const current = await readFile(operation.path, 'utf8').catch((error: unknown) => {
        if (isNodeError(error) && error.code === 'ENOENT') return undefined
        throw error
      })
      if (current !== operation.expectedOriginal) {
        throw new Error(`Patch precondition failed for "${operation.path}"`)
      }
    }

    if (operation.kind === 'delete') {
      await rm(operation.path, { force: true })
      return
    }

    await mkdir(dirname(operation.path), { recursive: true })
    await writeFile(operation.path, operation.content ?? '', 'utf8')
  }

  private resolveAllowedPath(path: string): string {
    const resolved = isAbsolute(path) ? resolve(path) : resolve(path)
    if (this.allowedRoots.length === 0) return resolved
    if (!this.allowedRoots.some(root => resolved === root || resolved.startsWith(`${root}/`))) {
      throw new Error(`path "${resolved}" is outside allowed roots`)
    }
    return resolved
  }

  private async requireWritePermission(path: string): Promise<void> {
    const decision = await this.broker.requestPermission(
      { type: 'filesystem', scope: 'workspace', access: 'write' },
      {
        ...this.context,
        operation: { kind: 'filesystem.write', path },
      },
    )
    if (!decision.granted) {
      throw new Error(decision.reason)
    }
  }

  private emitToolCall(callId: string, input: unknown): void {
    this.emitEvent({
      type: 'tool_call',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: 'telegraph-node-patch-capability@0.0.0',
      origin: { framework: 'telegraph', runtimeId: 'node-patch-capability' },
      runId: this.context.runId,
      callId,
      toolName: 'patch.apply',
      input,
      ts: this.now(),
    })
  }

  private emitToolResult(callId: string, output: unknown): void {
    this.emitEvent({
      type: 'tool_result',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: 'telegraph-node-patch-capability@0.0.0',
      origin: { framework: 'telegraph', runtimeId: 'node-patch-capability' },
      runId: this.context.runId,
      callId,
      toolName: 'patch.apply',
      output,
      ts: this.now(),
    })
  }

  private emitToolError(callId: string, error: unknown): void {
    this.emitEvent({
      type: 'tool_error',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: 'telegraph-node-patch-capability@0.0.0',
      origin: { framework: 'telegraph', runtimeId: 'node-patch-capability' },
      runId: this.context.runId,
      callId,
      toolName: 'patch.apply',
      error: {
        code: error instanceof Error ? error.name : 'patch_apply_error',
        message: error instanceof Error ? error.message : String(error),
      },
      ts: this.now(),
    })
  }

  private emitEvent(event: AgentEvent): void {
    if (!this.emit) return
    try {
      void Promise.resolve(this.emit(event, this.context)).catch(() => {})
    } catch {
      // Capability trace is observability only; it must not block patch application.
    }
  }
}

function spawnProcess(
  command: string,
  args: string[],
  options: {
    cwd?: string
    env?: Record<string, string>
    timeoutMs?: number
    maxOutputBytes: number
  },
): Promise<ProcessExecResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: false,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = options.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGTERM')
          rejectOnce(new Error(`Command timed out after ${String(options.timeoutMs)}ms`))
        }, options.timeoutMs)
      : undefined

    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      reject(error)
    }

    const append = (kind: 'stdout' | 'stderr', chunk: Buffer) => {
      const next = (kind === 'stdout' ? stdout : stderr) + chunk.toString('utf8')
      if (Buffer.byteLength(next) > options.maxOutputBytes) {
        child.kill('SIGTERM')
        rejectOnce(new Error(`Command output exceeded ${String(options.maxOutputBytes)} bytes`))
        return
      }
      if (kind === 'stdout') stdout = next
      else stderr = next
    }

    child.stdout.on('data', chunk => { append('stdout', chunk as Buffer); })
    child.stderr.on('data', chunk => { append('stderr', chunk as Buffer); })
    child.on('error', rejectOnce)
    child.on('close', code => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      resolvePromise({ stdout, stderr, code })
    })
  })
}

function summarizePatch(operations: PatchFileOperation[]): PatchPreview['summary'] {
  return {
    adds: operations.filter(operation => operation.kind === 'add').length,
    updates: operations.filter(operation => operation.kind === 'update').length,
    deletes: operations.filter(operation => operation.kind === 'delete').length,
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
