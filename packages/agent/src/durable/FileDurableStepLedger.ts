import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DurableStepLedger, DurableStepRecord } from './DurableRunEngine'

export class FileDurableStepLedger implements DurableStepLedger {
  private readonly filePath: string
  private records: Map<string, DurableStepRecord> | null = null

  constructor(dataDir: string, fileName = 'durable-steps.json') {
    this.filePath = join(dataDir, fileName)
  }

  async get<Output = unknown>(idempotencyKey: string): Promise<DurableStepRecord<Output> | null> {
    await this.ensureLoaded()
    const record = this.records?.get(idempotencyKey)
    return record ? structuredClone(record) as DurableStepRecord<Output> : null
  }

  async put(record: DurableStepRecord): Promise<void> {
    await this.ensureLoaded()
    this.records?.set(record.idempotencyKey, structuredClone(record))
    await this.save()
  }

  private async ensureLoaded(): Promise<void> {
    if (this.records) return
    this.records = new Map()
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return
      for (const record of parsed) {
        if (isDurableStepRecord(record)) {
          this.records.set(record.idempotencyKey, record)
        }
      }
    } catch (error) {
      if (isNotFound(error)) return
      throw error
    }
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(
      tempPath,
      `${JSON.stringify(Array.from(this.records?.values() ?? []), null, 2)}\n`,
      'utf8',
    )
    await rename(tempPath, this.filePath)
  }
}

function isDurableStepRecord(value: unknown): value is DurableStepRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<DurableStepRecord>
  return typeof record.idempotencyKey === 'string' &&
    typeof record.runId === 'string' &&
    typeof record.stepId === 'string' &&
    isDurableStepStatus(record.status) &&
    typeof record.startedAt === 'number'
}

function isDurableStepStatus(value: unknown): value is DurableStepRecord['status'] {
  return value === 'running' || value === 'completed' || value === 'failed'
}

function isNotFound(error: unknown): boolean {
  return !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
}
