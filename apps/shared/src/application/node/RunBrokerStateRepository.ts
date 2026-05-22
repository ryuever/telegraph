import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type {
  ApprovalRequestChangeEvent,
  ApprovalRequestRecord,
  RunControlCommandChangeEvent,
  RunControlCommandRecord,
  RunIntentRecord,
  RunProjectionChangeEvent,
  RunProjectionRecord,
} from '@/packages/run-protocol'

export interface RunBrokerStateSnapshot {
  intents: RunIntentRecord[]
  projections: RunProjectionRecord[]
  projectionHistory: RunProjectionChangeEvent[]
  approvals: ApprovalRequestRecord[]
  approvalHistory?: ApprovalRequestChangeEvent[]
  runControlCommands?: RunControlCommandRecord[]
  runControlHistory?: RunControlCommandChangeEvent[]
}

export interface RunBrokerStateRepository {
  load(): RunBrokerStateSnapshot | null
  save(snapshot: RunBrokerStateSnapshot): void
}

export class FileRunBrokerStateRepository implements RunBrokerStateRepository {
  constructor(private readonly path = join(process.cwd(), '.telegraph', 'run-broker', 'state.json')) {}

  load(): RunBrokerStateSnapshot | null {
    if (!existsSync(this.path)) return null
    return JSON.parse(readFileSync(this.path, 'utf8')) as RunBrokerStateSnapshot
  }

  save(snapshot: RunBrokerStateSnapshot): void {
    mkdirSync(dirname(this.path), { recursive: true })
    const tmpPath = `${this.path}.tmp`
    writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8')
    renameSync(tmpPath, this.path)
  }
}
