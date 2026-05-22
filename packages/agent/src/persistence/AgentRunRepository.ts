import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { appendFile, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentEvent, RuntimeSettings } from '@/packages/agent-protocol'

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export type AgentRunFailureReason =
  | 'runtime_offline'
  | 'runtime_recovery'
  | 'timeout'
  | 'agent_error'
  | 'permission_denied'
  | 'cancelled'

export interface AgentRunSettingsSummary {
  provider?: string
  modelId?: string
  backend?: string
  orchestration?: string
  orchestrationPattern?: string | null
  taskCapabilityProfile?: string
}

export type AgentRunReplayMode = 'manual_rerun' | 'retry' | 'fork'

export interface AgentRunInputSnapshot {
  message: string
}

export interface AgentRunReplaySource {
  mode: AgentRunReplayMode
  sourceRunId: string
  sourceEventSeq?: number
  sourceChildRunId?: string
}

export interface AgentRunRecord {
  runId: string
  sessionId: string
  parentRunId?: string
  status: AgentRunStatus
  runtimeId: string
  teamId?: string
  agentId?: string
  failureReason?: AgentRunFailureReason
  failureMessage?: string
  sessionRef?: string
  workDir?: string
  artifactRefs: string[]
  settings: AgentRunSettingsSummary
  input?: AgentRunInputSnapshot
  replay?: AgentRunReplaySource
  inputPreview?: string
  eventCount: number
  createdAt: number
  startedAt?: number
  completedAt?: number
  lastEventAt?: number
}

export interface AgentRunEventRecord {
  runId: string
  sessionId?: string
  seq: number
  event: AgentEvent
  ts: number
}

export interface CreateAgentRunInput {
  runId: string
  sessionId: string
  runtimeId: string
  settings?: RuntimeSettings
  input?: AgentRunInputSnapshot
  replay?: AgentRunReplaySource
  inputPreview?: string
  parentRunId?: string
  teamId?: string
  agentId?: string
  sessionRef?: string
  workDir?: string
  artifactRefs?: string[]
  now?: number
}

export interface ImportAgentRunBundleInput {
  run: AgentRunRecord
  events: AgentRunEventRecord[]
}

export interface ImportAgentRunBundleResult {
  status: 'imported' | 'existing'
  record: AgentRunRecord
}

export interface ListAgentRunsOptions {
  sessionId?: string
  status?: AgentRunStatus
  limit?: number
  offset?: number
}

export interface AgentRunRepository {
  createRun(input: CreateAgentRunInput): Promise<AgentRunRecord>
  appendEvent(runId: string, event: AgentEvent): Promise<AgentRunEventRecord>
  appendEvents(runId: string, events: AgentEvent[]): Promise<AgentRunEventRecord[]>
  updateRun(runId: string, patch: Partial<AgentRunRecord>): Promise<AgentRunRecord>
  getRun(runId: string): Promise<AgentRunRecord | null>
  listRuns(options?: ListAgentRunsOptions): Promise<AgentRunRecord[]>
  listRunEvents(runId: string): Promise<AgentRunEventRecord[]>
  importRunBundle(input: ImportAgentRunBundleInput): Promise<ImportAgentRunBundleResult>
  markRunningRunsRecovered(now?: number): Promise<AgentRunRecord[]>
}

export class FileAgentRunRepository implements AgentRunRepository {
  private readonly dataDir: string
  private readonly runQueues = new Map<string, Promise<unknown>>()

  constructor(dataDir = join(process.cwd(), '.telegraph', 'runs')) {
    this.dataDir = dataDir
    ensureDir(this.dataDir)
  }

  async createRun(input: CreateAgentRunInput): Promise<AgentRunRecord> {
    const now = input.now ?? Date.now()
    const existing = await this.getRun(input.runId)
    if (existing) return existing

    const record: AgentRunRecord = {
      runId: input.runId,
      sessionId: input.sessionId,
      parentRunId: input.parentRunId,
      status: 'queued',
      runtimeId: input.runtimeId,
      teamId: input.teamId,
      agentId: input.agentId,
      sessionRef: input.sessionRef,
      workDir: input.workDir,
      artifactRefs: input.artifactRefs ?? [],
      settings: summarizeRuntimeSettings(input.settings),
      input: input.input,
      replay: input.replay,
      inputPreview: compactPreview(input.inputPreview ?? input.input?.message),
      eventCount: 0,
      createdAt: now,
    }

    ensureDir(this.runDir(input.runId))
    await writeJsonAtomic(this.recordPath(input.runId), record)
    await writeFile(this.eventsPath(input.runId), '', { flag: 'wx' }).catch(() => undefined)
    return record
  }

  async appendEvent(runId: string, event: AgentEvent): Promise<AgentRunEventRecord> {
    const [record] = await this.appendEvents(runId, [event])
    if (!record) throw new Error(`No event was appended for run "${runId}"`)
    return record
  }

  async appendEvents(runId: string, events: AgentEvent[]): Promise<AgentRunEventRecord[]> {
    if (events.length === 0) return []
    return this.enqueueRunWrite(runId, async () => {
      let record = await this.requireRun(runId)
      const eventRecords: AgentRunEventRecord[] = []
      for (const event of events) {
        const eventRecord: AgentRunEventRecord = {
          runId,
          sessionId: record.sessionId,
          seq: record.eventCount + 1,
          event,
          ts: eventTs(event),
        }
        eventRecords.push(eventRecord)
        record = applyRunPatch(record, patchForEvent(record, event))
      }
      await appendFile(
        this.eventsPath(runId),
        `${eventRecords.map(eventRecord => JSON.stringify(eventRecord)).join('\n')}\n`,
        'utf8',
      )
      await this.writeRunRecord(runId, record)
      return eventRecords
    })
  }

  async updateRun(runId: string, patch: Partial<AgentRunRecord>): Promise<AgentRunRecord> {
    return this.enqueueRunWrite(runId, async () => {
      const current = await this.requireRun(runId)
      const next = applyRunPatch(current, patch)
      await this.writeRunRecord(runId, next)
      return next
    })
  }

  async getRun(runId: string): Promise<AgentRunRecord | null> {
    const path = this.recordPath(runId)
    if (!existsSync(path)) return null
    return readJson<AgentRunRecord>(path)
  }

  async listRuns(options: ListAgentRunsOptions = {}): Promise<AgentRunRecord[]> {
    const dirs = existsSync(this.dataDir) ? readdirSync(this.dataDir, { withFileTypes: true }) : []
    const records: AgentRunRecord[] = []
    for (const entry of dirs) {
      if (!entry.isDirectory()) continue
      const record = await this.getRun(entry.name)
      if (!record) continue
      if (options.sessionId && record.sessionId !== options.sessionId) continue
      if (options.status && record.status !== options.status) continue
      records.push(record)
    }
    records.sort((a, b) => b.createdAt - a.createdAt)
    const offset = options.offset ?? 0
    const limit = options.limit ?? 100
    return records.slice(offset, offset + limit)
  }

  async listRunEvents(runId: string): Promise<AgentRunEventRecord[]> {
    const path = this.eventsPath(runId)
    if (!existsSync(path)) return []
    const raw = await readFile(path, 'utf8')
    return raw
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => JSON.parse(line) as AgentRunEventRecord)
      .sort((a, b) => a.seq - b.seq)
  }

  async importRunBundle(input: ImportAgentRunBundleInput): Promise<ImportAgentRunBundleResult> {
    const existing = await this.getRun(input.run.runId)
    if (existing) {
      return {
        status: 'existing',
        record: existing,
      }
    }

    const events = input.events
      .filter(event => event.runId === input.run.runId)
      .sort((a, b) => a.seq - b.seq)
      .map((event, index) => ({
        ...event,
        seq: index + 1,
        sessionId: event.sessionId ?? input.run.sessionId,
      }))
    const record: AgentRunRecord = pruneUndefined({
      ...input.run,
      eventCount: events.length,
      inputPreview: compactPreview(input.run.inputPreview ?? input.run.input?.message),
    })

    ensureDir(this.runDir(record.runId))
    await writeJsonAtomic(this.recordPath(record.runId), record)
    await writeFile(
      this.eventsPath(record.runId),
      events.map(event => JSON.stringify(event)).join('\n') + (events.length > 0 ? '\n' : ''),
      'utf8',
    )
    return {
      status: 'imported',
      record,
    }
  }

  async markRunningRunsRecovered(now = Date.now()): Promise<AgentRunRecord[]> {
    const candidates = await this.listRuns({ limit: Number.MAX_SAFE_INTEGER })
    const recovered: AgentRunRecord[] = []
    for (const record of candidates) {
      if (record.status !== 'queued' && record.status !== 'running') continue
      recovered.push(await this.updateRun(record.runId, {
        status: 'failed',
        failureReason: 'runtime_recovery',
        failureMessage: 'Run was still active when the pagelet process started.',
        completedAt: now,
        lastEventAt: now,
      }))
    }
    return recovered
  }

  private async enqueueRunWrite<T>(runId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.runQueues.get(runId) ?? Promise.resolve()
    const next = previous.then(task, task)
    const stored = next.catch(() => undefined)
    this.runQueues.set(runId, stored)
    try {
      return await next
    } finally {
      if (this.runQueues.get(runId) === stored) {
        this.runQueues.delete(runId)
      }
    }
  }

  private async writeRunRecord(runId: string, record: AgentRunRecord): Promise<void> {
    await writeJsonAtomic(this.recordPath(runId), record)
  }

  private async requireRun(runId: string): Promise<AgentRunRecord> {
    const record = await this.getRun(runId)
    if (!record) throw new Error(`Agent run "${runId}" was not found`)
    return record
  }

  private runDir(runId: string): string {
    return join(this.dataDir, sanitizePathSegment(runId))
  }

  private recordPath(runId: string): string {
    return join(this.runDir(runId), 'record.json')
  }

  private eventsPath(runId: string): string {
    return join(this.runDir(runId), 'events.jsonl')
  }
}

function applyRunPatch(current: AgentRunRecord, patch: Partial<AgentRunRecord>): AgentRunRecord {
  return pruneUndefined({
    ...current,
    ...patch,
    runId: current.runId,
    sessionId: current.sessionId,
    runtimeId: patch.runtimeId ?? current.runtimeId,
    artifactRefs: patch.artifactRefs ?? current.artifactRefs,
    settings: patch.settings ?? current.settings,
    input: patch.input ?? current.input,
    replay: patch.replay ?? current.replay,
  })
}

function summarizeRuntimeSettings(settings: RuntimeSettings | undefined): AgentRunSettingsSummary {
  return {
    provider: settings?.provider,
    modelId: settings?.modelId,
    backend: settings?.backend,
    orchestration: settings?.orchestration,
    orchestrationPattern: settings?.orchestrationPattern,
    taskCapabilityProfile: settings?.taskCapabilityProfile?.kind,
  }
}

function patchForEvent(record: AgentRunRecord, event: AgentEvent): Partial<AgentRunRecord> {
  const ts = eventTs(event)
  const base: Partial<AgentRunRecord> = {
    eventCount: record.eventCount + 1,
    lastEventAt: ts,
  }

  switch (event.type) {
    case 'run_started':
      return {
        ...base,
        status: 'running',
        startedAt: record.startedAt ?? ts,
      }
    case 'run_completed':
      return {
        ...base,
        status: 'completed',
        completedAt: ts,
        artifactRefs: mergeArtifactRefs(record.artifactRefs, event.output),
      }
    case 'run_failed':
      return {
        ...base,
        status: 'failed',
        completedAt: ts,
        failureReason: failureReasonForErrorCode(event.error.code),
        failureMessage: event.error.message,
      }
    case 'run_cancelled':
      return {
        ...base,
        status: 'cancelled',
        completedAt: ts,
        failureReason: 'cancelled',
        failureMessage: event.reason,
      }
    case 'tool_result':
      return {
        ...base,
        artifactRefs: mergeArtifactRefs(record.artifactRefs, event.output),
      }
    default:
      return base
  }
}

function failureReasonForErrorCode(code: string): AgentRunFailureReason {
  if (code.includes('permission')) return 'permission_denied'
  if (code.includes('timeout')) return 'timeout'
  if (code.includes('runtime_offline')) return 'runtime_offline'
  if (code.includes('runtime_recovery')) return 'runtime_recovery'
  if (code.includes('cancel')) return 'cancelled'
  return 'agent_error'
}

function mergeArtifactRefs(current: string[], output: unknown): string[] {
  const refs = extractArtifactRefs(output)
  if (refs.length === 0) return current
  return [...new Set([...current, ...refs])]
}

function extractArtifactRefs(value: unknown): string[] {
  if (!value || typeof value !== 'object') return []
  const refs: string[] = []
  const record = value as Record<string, unknown>

  if (Array.isArray(record.artifactRefs)) {
    refs.push(...record.artifactRefs.filter((item): item is string => typeof item === 'string'))
  }

  if (isArtifactRef(record.artifactRef)) {
    refs.push(record.artifactRef.uri)
  }

  if (Array.isArray(record.observations)) {
    for (const observation of record.observations) {
      if (!observation || typeof observation !== 'object') continue
      const artifactRef = (observation as Record<string, unknown>).artifactRef
      if (isArtifactRef(artifactRef)) refs.push(artifactRef.uri)
    }
  }

  return refs
}

function isArtifactRef(value: unknown): value is { uri: string } {
  return Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { uri?: unknown }).uri === 'string'
}

function eventTs(event: AgentEvent): number {
  return typeof event.ts === 'number' ? event.ts : Date.now()
}

function compactPreview(value: string | undefined): string | undefined {
  if (!value) return undefined
  const compact = value.replace(/\s+/g, ' ').trim()
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}
