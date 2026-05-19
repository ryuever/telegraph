import { spawn } from 'node:child_process'
import { mkdir, open, opendir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { Tool } from '@mariozechner/pi-ai'
import type { RuntimeTaskCapabilityProfile } from '@/packages/agent-protocol'
import { PermissionBroker, type PermissionBrokerRequestContext } from '@/packages/agent/harness/PermissionBroker'
import type { AgentRuntimeSettings } from '../../types'
import type { PiAiExecutableTool } from '../streamPiAiRuntime'

const READ_MAX_BYTES = 128 * 1024
const GREP_MAX_FILE_BYTES = 512 * 1024
const BASH_MAX_OUTPUT_BYTES = 256 * 1024
const BASH_DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_GREP_MAX_MATCHES = 100
const DEFAULT_GLOB_MAX_RESULTS = 200
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'out', '.vite', 'coverage'])
const SUBAGENT_TOOL_NAMES = new Set(['read', 'grep', 'glob', 'bash', 'edit'])

export interface ReadonlySubagentToolOptions {
  runId: string
  sessionId?: string
  settings: AgentRuntimeSettings
  workspaceRoot?: string
  allowedTools?: string[]
}

export function createSubagentTools(options: ReadonlySubagentToolOptions): PiAiExecutableTool[] {
  const allowed = new Set((options.allowedTools ?? []).filter(name => SUBAGENT_TOOL_NAMES.has(name)))
  if (allowed.size === 0) return []

  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd())
  const broker = new PermissionBroker({ prompt: () => false })
  const context = createPermissionContext(options, workspaceRoot)
  const tools: PiAiExecutableTool[] = []

  if (allowed.has('read')) {
    tools.push(createReadTool({ workspaceRoot, broker, context }))
  }
  if (allowed.has('grep')) {
    tools.push(createGrepTool({ workspaceRoot, broker, context }))
  }
  if (allowed.has('glob')) {
    tools.push(createGlobTool({ workspaceRoot, broker, context }))
  }
  if (allowed.has('bash') && shouldExposeBash(options.settings.taskCapabilityProfile)) {
    tools.push(createBashTool({ workspaceRoot, broker, context }))
  }
  if (allowed.has('edit') && shouldExposeEdit(options.settings.taskCapabilityProfile)) {
    tools.push(createEditTool({ workspaceRoot, broker, context }))
  }

  return tools
}

export const createReadonlySubagentTools = createSubagentTools

interface ToolFactoryOptions {
  workspaceRoot: string
  broker: PermissionBroker
  context: PermissionBrokerRequestContext
}

function createReadTool(options: ToolFactoryOptions): PiAiExecutableTool {
  return {
    name: 'read',
    description: 'Read a UTF-8 text file from the current workspace. Use relative paths.',
    parameters: objectSchema({
      path: stringSchema('Workspace-relative file path to read.'),
      startLine: numberSchema('Optional 1-based line number to start reading from.'),
      maxLines: numberSchema('Optional maximum number of lines to return.'),
    }, ['path']),
    async execute(input) {
      const path = requireString(input.path, 'path')
      const resolved = resolveWorkspacePath(options.workspaceRoot, path)
      await requireWorkspaceRead(options.broker, options.context, resolved)
      const content = await readLimitedTextFile(resolved, READ_MAX_BYTES)
      const startLine = optionalPositiveInteger(input.startLine) ?? 1
      const maxLines = optionalPositiveInteger(input.maxLines)
      const lines = content.split(/\r?\n/)
      const selected = lines.slice(startLine - 1, maxLines ? startLine - 1 + maxLines : undefined)
      return {
        path: toWorkspaceRelative(options.workspaceRoot, resolved),
        startLine,
        endLine: startLine + Math.max(selected.length - 1, 0),
        truncated: Buffer.byteLength(content, 'utf8') >= READ_MAX_BYTES,
        content: selected.join('\n'),
      }
    },
  }
}

function createGrepTool(options: ToolFactoryOptions): PiAiExecutableTool {
  return {
    name: 'grep',
    description: 'Search workspace text files for a string or regular expression pattern.',
    parameters: objectSchema({
      pattern: stringSchema('Text or JavaScript regular expression pattern to search for.'),
      path: stringSchema('Optional workspace-relative directory or file to search. Defaults to workspace root.'),
      caseSensitive: booleanSchema('Whether matching should be case-sensitive. Defaults to false.'),
      maxMatches: numberSchema('Maximum number of matches to return. Defaults to 100.'),
    }, ['pattern']),
    async execute(input) {
      const pattern = requireString(input.pattern, 'pattern')
      const searchRoot = resolveWorkspacePath(options.workspaceRoot, optionalString(input.path) ?? '.')
      await requireWorkspaceRead(options.broker, options.context, searchRoot)
      const maxMatches = optionalPositiveInteger(input.maxMatches) ?? DEFAULT_GREP_MAX_MATCHES
      const flags = input.caseSensitive === true ? '' : 'i'
      const regex = new RegExp(pattern, flags)
      const matches: Array<{ path: string; line: number; text: string }> = []

      for await (const file of walkTextFiles(searchRoot)) {
        if (matches.length >= maxMatches) break
        const fileContent = await readLimitedTextFile(file, GREP_MAX_FILE_BYTES).catch(() => undefined)
        if (fileContent === undefined) continue
        const lines = fileContent.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i] ?? '')) {
            matches.push({
              path: toWorkspaceRelative(options.workspaceRoot, file),
              line: i + 1,
              text: lines[i] ?? '',
            })
            if (matches.length >= maxMatches) break
          }
          regex.lastIndex = 0
        }
      }

      return {
        pattern,
        path: toWorkspaceRelative(options.workspaceRoot, searchRoot),
        matches,
        truncated: matches.length >= maxMatches,
      }
    },
  }
}

function createGlobTool(options: ToolFactoryOptions): PiAiExecutableTool {
  return {
    name: 'glob',
    description: 'List workspace files matching a glob pattern such as "src/**/*.ts".',
    parameters: objectSchema({
      pattern: stringSchema('Glob pattern relative to the workspace root. Supports *, ?, and **.'),
      path: stringSchema('Optional workspace-relative directory to search. Defaults to workspace root.'),
      maxResults: numberSchema('Maximum number of file paths to return. Defaults to 200.'),
    }, ['pattern']),
    async execute(input) {
      const pattern = requireString(input.pattern, 'pattern')
      const searchRoot = resolveWorkspacePath(options.workspaceRoot, optionalString(input.path) ?? '.')
      await requireWorkspaceRead(options.broker, options.context, searchRoot)
      const maxResults = optionalPositiveInteger(input.maxResults) ?? DEFAULT_GLOB_MAX_RESULTS
      const regex = globToRegExp(pattern)
      const paths: string[] = []

      for await (const file of walkTextFiles(searchRoot)) {
        const rel = toWorkspaceRelative(options.workspaceRoot, file)
        if (regex.test(rel)) {
          paths.push(rel)
          if (paths.length >= maxResults) break
        }
      }

      return {
        pattern,
        paths,
        truncated: paths.length >= maxResults,
      }
    },
  }
}

function createBashTool(options: ToolFactoryOptions): PiAiExecutableTool {
  return {
    name: 'bash',
    description: 'Run one allowed workspace command without shell expansion. Provide command and args separately.',
    parameters: objectSchema({
      command: stringSchema('Executable name, such as "git", "rg", "pnpm", or "node".'),
      args: arraySchema('Command arguments. Do not include shell control operators.'),
      cwd: stringSchema('Optional workspace-relative working directory. Defaults to workspace root.'),
      timeoutMs: numberSchema('Optional timeout in milliseconds. Defaults to 30000.'),
      risk: stringEnumSchema(['low', 'medium', 'high'], 'Execution risk. Only low risk commands can be auto-granted.'),
    }, ['command']),
    async execute(input) {
      const command = requireSafeCommand(input.command)
      const args = optionalStringArray(input.args).map(requireSafeArg)
      const cwd = resolveWorkspacePath(options.workspaceRoot, optionalString(input.cwd) ?? '.')
      const timeoutMs = optionalPositiveInteger(input.timeoutMs) ?? BASH_DEFAULT_TIMEOUT_MS
      const risk = input.risk === 'medium' || input.risk === 'high' ? input.risk : 'low'

      await requireShellPermission(options.broker, options.context, command, cwd, risk)
      const result = await spawnProcess(command, args, {
        cwd,
        timeoutMs,
        maxOutputBytes: BASH_MAX_OUTPUT_BYTES,
      })
      return {
        command,
        args,
        cwd: toWorkspaceRelative(options.workspaceRoot, cwd),
        ...result,
      }
    },
  }
}

function createEditTool(options: ToolFactoryOptions): PiAiExecutableTool {
  return {
    name: 'edit',
    description: 'Replace text in a workspace UTF-8 file. Requires an exact oldString match.',
    parameters: objectSchema({
      path: stringSchema('Workspace-relative file path to edit.'),
      oldString: stringSchema('Exact text to replace.'),
      newString: stringSchema('Replacement text.'),
      replaceAll: booleanSchema('Replace every occurrence instead of only the first occurrence. Defaults to false.'),
      apply: booleanSchema('When true, write the replacement. When false or omitted, return a preview only.'),
    }, ['path', 'oldString', 'newString']),
    async execute(input) {
      const path = requireString(input.path, 'path')
      const oldString = requireString(input.oldString, 'oldString')
      const newString = requirePresentString(input.newString, 'newString')
      const resolved = resolveWorkspacePath(options.workspaceRoot, path)

      const current = await readEditableTextFile(resolved, READ_MAX_BYTES)
      if (!current.includes(oldString)) {
        throw new Error(`oldString was not found in "${path}"`)
      }
      const replacementCount = input.replaceAll === true
        ? countOccurrences(current, oldString)
        : 1
      const next = input.replaceAll === true
        ? current.split(oldString).join(newString)
        : current.replace(oldString, newString)
      const apply = input.apply === true
      if (apply) {
        if (!canApplyEdit(options.context.taskProfile)) {
          throw new Error('edit apply requires an apply-enabled coding or design profile')
        }
        await requireWorkspaceRead(options.broker, options.context, resolved)
        await requireWorkspaceWrite(options.broker, options.context, resolved)
        await mkdir(dirname(resolved), { recursive: true })
        await writeFile(resolved, next, 'utf8')
      }
      return {
        path: toWorkspaceRelative(options.workspaceRoot, resolved),
        replacements: replacementCount,
        applied: apply,
        beforeBytes: Buffer.byteLength(current, 'utf8'),
        afterBytes: Buffer.byteLength(next, 'utf8'),
        preview: {
          oldString,
          newString,
        },
      }
    },
  }
}

async function requireWorkspaceRead(
  broker: PermissionBroker,
  context: PermissionBrokerRequestContext,
  path: string,
): Promise<void> {
  const decision = await broker.requestPermission(
    { type: 'filesystem', scope: 'workspace', access: 'read' },
    {
      ...context,
      operation: { kind: 'filesystem.read', path },
    },
  )
  if (!decision.granted) {
    throw new Error(decision.reason)
  }
}

async function requireWorkspaceWrite(
  broker: PermissionBroker,
  context: PermissionBrokerRequestContext,
  path: string,
): Promise<void> {
  const decision = await broker.requestPermission(
    { type: 'filesystem', scope: 'workspace', access: 'write' },
    {
      ...context,
      operation: { kind: 'filesystem.write', path },
    },
  )
  if (!decision.granted) {
    throw new Error(decision.reason)
  }
}

async function requireShellPermission(
  broker: PermissionBroker,
  context: PermissionBrokerRequestContext,
  command: string,
  cwd: string,
  risk: 'low' | 'medium' | 'high',
): Promise<void> {
  const decision = await broker.requestPermission(
    { type: 'shell', risk },
    {
      ...context,
      operation: { kind: 'shell.exec', command, cwd },
    },
  )
  if (!decision.granted) {
    throw new Error(decision.reason)
  }
}

function createPermissionContext(
  options: ReadonlySubagentToolOptions,
  workspaceRoot: string,
): PermissionBrokerRequestContext {
  return {
    runId: options.runId,
    sessionId: options.sessionId,
    pageletId: 'chat',
    pageletKind: 'chat',
    taskProfile: permissionProfile(options.settings.taskCapabilityProfile),
    userIntent: {
      summary: 'pi-subagents readonly workspace tool call',
      requestedCapabilities: ['filesystem'],
    },
    pageletPolicy: {
      allowedCapabilities: allowedCapabilities(options.settings.taskCapabilityProfile),
    },
    workspacePolicy: {
      shell: workspaceShellPolicy(options.settings.taskCapabilityProfile),
      filesystem: {
        readableScopes: ['workspace'],
        writableScopes: canApplyEdit(options.settings.taskCapabilityProfile) ? ['workspace'] : [],
        autoGrantWrites: canApplyEdit(options.settings.taskCapabilityProfile),
      },
    },
    operation: { kind: 'filesystem.read', path: workspaceRoot },
  }
}

function permissionProfile(profile: RuntimeTaskCapabilityProfile | undefined): RuntimeTaskCapabilityProfile {
  if (profile && profile.kind !== 'default') {
    return profile
  }
  return { kind: 'readonly-workspace', scopes: ['repo:read'] }
}

function allowedCapabilities(profile: RuntimeTaskCapabilityProfile | undefined): Array<'filesystem' | 'shell'> {
  if (profile?.kind === 'shell-automation') return ['filesystem', 'shell']
  return ['filesystem']
}

function workspaceShellPolicy(profile: RuntimeTaskCapabilityProfile | undefined) {
  if (profile?.kind !== 'shell-automation') return undefined
  return {
    allowedCommands: profile.commands?.length ? profile.commands : undefined,
    autoGrantUpToRisk: 'low' as const,
    maxRisk: 'medium' as const,
  }
}

function shouldExposeBash(profile: RuntimeTaskCapabilityProfile | undefined): boolean {
  return profile?.kind === 'shell-automation'
}

function shouldExposeEdit(profile: RuntimeTaskCapabilityProfile | undefined): boolean {
  return profile?.kind === 'coding-edit' || profile?.kind === 'design-build'
}

function canApplyEdit(profile: unknown): boolean {
  if (!profile || typeof profile !== 'object') return false
  const candidate = profile as Partial<RuntimeTaskCapabilityProfile>
  if (candidate.kind === 'coding-edit') {
    return candidate.patchPolicy === 'apply-after-confirm'
  }
  if (candidate.kind === 'design-build') {
    return candidate.artifactPolicy === 'apply-after-confirm'
  }
  return false
}

async function readLimitedTextFile(path: string, maxBytes: number): Promise<string> {
  const info = await stat(path)
  if (!info.isFile()) {
    throw new Error(`path "${path}" is not a file`)
  }
  if (info.size <= maxBytes) {
    return readFile(path, 'utf8')
  }

  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes)
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } finally {
    await handle.close()
  }
}

async function readEditableTextFile(path: string, maxBytes: number): Promise<string> {
  const info = await stat(path)
  if (!info.isFile()) {
    throw new Error(`path "${path}" is not a file`)
  }
  if (info.size > maxBytes) {
    throw new Error(`file "${path}" exceeds editable size limit of ${String(maxBytes)} bytes`)
  }
  return readFile(path, 'utf8')
}

async function* walkTextFiles(root: string): AsyncGenerator<string> {
  const info = await stat(root)
  if (info.isFile()) {
    yield root
    return
  }
  if (!info.isDirectory()) return

  const dir = await opendir(root)
  for await (const entry of dir) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue
    const path = resolve(root, entry.name)
    if (entry.isDirectory()) {
      yield* walkTextFiles(path)
    } else if (entry.isFile()) {
      yield path
    }
  }
}

function resolveWorkspacePath(workspaceRoot: string, path: string): string {
  if (path.includes('\0')) {
    throw new Error('path contains a null byte')
  }
  const resolved = isAbsolute(path) ? resolve(path) : resolve(workspaceRoot, path)
  if (!isInside(workspaceRoot, resolved)) {
    throw new Error(`path "${path}" is outside the workspace`)
  }
  return resolved
}

function isInside(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function toWorkspaceRelative(workspaceRoot: string, path: string): string {
  const rel = relative(workspaceRoot, path)
  return rel === '' ? '.' : rel.split(sep).join('/')
}

function globToRegExp(pattern: string): RegExp {
  let source = '^'
  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i]
    const next = pattern[i + 1]
    if (char === '*' && next === '*') {
      source += '.*'
      i += 1
      continue
    }
    if (char === '*') {
      source += '[^/]*'
      continue
    }
    if (char === '?') {
      source += '[^/]'
      continue
    }
    source += escapeRegExp(char)
  }
  return new RegExp(`${source}$`)
}

function escapeRegExp(value: string | undefined): string {
  return (value ?? '').replace(/[|\\{}()[\]^$+*?.]/g, '\\$&')
}

function objectSchema(properties: Record<string, unknown>, required: string[]): Tool['parameters'] {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  } as Tool['parameters']
}

function stringSchema(description: string): unknown {
  return { type: 'string', description }
}

function numberSchema(description: string): unknown {
  return { type: 'number', description }
}

function booleanSchema(description: string): unknown {
  return { type: 'boolean', description }
}

function arraySchema(description: string): unknown {
  return {
    type: 'array',
    description,
    items: { type: 'string' },
  }
}

function stringEnumSchema(values: string[], description: string): unknown {
  return {
    type: 'string',
    description,
    enum: values,
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`"${name}" must be a non-empty string`)
  }
  return value
}

function requirePresentString(value: unknown, name: string): string {
  if (typeof value !== 'string') {
    throw new Error(`"${name}" must be a string`)
  }
  return value
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string')
}

function optionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const integer = Math.floor(value)
  return integer > 0 ? integer : undefined
}

function requireSafeCommand(value: unknown): string {
  const command = requireString(value, 'command')
  if (command.includes('/') || command.includes('\\') || command.trim() !== command) {
    throw new Error('"command" must be a bare executable name')
  }
  return requireSafeShellToken(command, 'command')
}

function requireSafeArg(value: string): string {
  return requireSafeShellToken(value, 'arg')
}

function requireSafeShellToken(value: string, name: string): string {
  if (/[\0\r\n;&|`$<>]/.test(value)) {
    throw new Error(`"${name}" contains unsupported shell control characters`)
  }
  return value
}

function countOccurrences(value: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let index = 0
  while (true) {
    const next = value.indexOf(needle, index)
    if (next < 0) return count
    count += 1
    index = next + needle.length
  }
}

function spawnProcess(
  command: string,
  args: string[],
  options: {
    cwd: string
    timeoutMs: number
    maxOutputBytes: number
  },
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      rejectOnce(new Error(`Command timed out after ${String(options.timeoutMs)}ms`))
    }, options.timeoutMs)

    const rejectOnce = (error: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }

    const append = (kind: 'stdout' | 'stderr', chunk: Buffer) => {
      const next = (kind === 'stdout' ? stdout : stderr) + chunk.toString('utf8')
      if (Buffer.byteLength(next, 'utf8') > options.maxOutputBytes) {
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
      clearTimeout(timer)
      resolvePromise({ stdout, stderr, code })
    })
  })
}
