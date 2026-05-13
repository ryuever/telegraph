import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type PersistedRunStatus = 'queued' | 'running' | 'completed' | 'failed'

type PersistedRun = {
  runId: string
  status: PersistedRunStatus
  startedAt: number
  updatedAt: number
  backend?: string
  orchestration?: string
  error?: string
}

type RegistryFile = {
  version: 1
  runs: PersistedRun[]
}

const REGISTRY_DIR = join(homedir(), '.telegraph')
const REGISTRY_FILE = join(REGISTRY_DIR, 'agent-runs.json')
const MAX_RUNS = 500

function ensureDir() {
  if (!existsSync(REGISTRY_DIR)) {
    mkdirSync(REGISTRY_DIR, { recursive: true })
  }
}

function loadFile(): RegistryFile {
  try {
    if (!existsSync(REGISTRY_FILE)) {
      return { version: 1, runs: [] }
    }
    const raw = readFileSync(REGISTRY_FILE, 'utf-8')
    const parsed = JSON.parse(raw) as RegistryFile
    if (!parsed || !Array.isArray(parsed.runs)) {
      return { version: 1, runs: [] }
    }
    return { version: 1, runs: parsed.runs }
  } catch {
    return { version: 1, runs: [] }
  }
}

function saveFile(file: RegistryFile) {
  ensureDir()
  const next: RegistryFile = {
    version: 1,
    runs: file.runs.slice(-MAX_RUNS),
  }
  writeFileSync(REGISTRY_FILE, JSON.stringify(next, null, 2), 'utf-8')
}

export class AgentRunRegistry {
  private file: RegistryFile

  constructor() {
    this.file = loadFile()
  }

  recoverOrphans(): number {
    let changed = 0
    const now = Date.now()
    this.file.runs = this.file.runs.map(run => {
      if (run.status === 'queued' || run.status === 'running') {
        changed += 1
        return {
          ...run,
          status: 'failed',
          updatedAt: now,
          error: run.error ?? 'daemon restarted before run completion',
        }
      }
      return run
    })
    if (changed > 0) {
      saveFile(this.file)
    }
    return changed
  }

  markQueued(runId: string, backend?: string, orchestration?: string) {
    const now = Date.now()
    this.upsert({
      runId,
      status: 'queued',
      startedAt: now,
      updatedAt: now,
      backend,
      orchestration,
    })
  }

  markRunning(runId: string) {
    const now = Date.now()
    this.upsert({
      runId,
      status: 'running',
      startedAt: now,
      updatedAt: now,
    })
  }

  markCompleted(runId: string) {
    const existing = this.get(runId)
    const now = Date.now()
    this.upsert({
      runId,
      status: 'completed',
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
      backend: existing?.backend,
      orchestration: existing?.orchestration,
    })
  }

  markFailed(runId: string, error: string) {
    const existing = this.get(runId)
    const now = Date.now()
    this.upsert({
      runId,
      status: 'failed',
      startedAt: existing?.startedAt ?? now,
      updatedAt: now,
      backend: existing?.backend,
      orchestration: existing?.orchestration,
      error,
    })
  }

  private get(runId: string): PersistedRun | undefined {
    return this.file.runs.find(r => r.runId === runId)
  }

  private upsert(run: PersistedRun) {
    const idx = this.file.runs.findIndex(r => r.runId === run.runId)
    if (idx >= 0) {
      this.file.runs[idx] = { ...this.file.runs[idx], ...run }
    } else {
      this.file.runs.push(run)
    }
    saveFile(this.file)
  }
}
