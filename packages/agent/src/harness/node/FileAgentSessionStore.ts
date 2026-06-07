import { existsSync, mkdirSync } from 'node:fs'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RuntimeMessage } from '@/packages/agent-protocol'
import type { AgentSessionStore } from '@/packages/agent/harness/AgentSessionStore'
import { resolveTelegraphDataDir } from '@/packages/agent/persistence/telegraphPaths'

export interface FileAgentSessionStoreOptions {
  maxMessages?: number
}

export class FileAgentSessionStore implements AgentSessionStore {
  private readonly dataDir: string
  private readonly maxMessages: number
  private readonly sessionQueues = new Map<string, Promise<unknown>>()

  constructor(dataDir = join(resolveTelegraphDataDir(), 'agent-sessions'), options: FileAgentSessionStoreOptions = {}) {
    this.dataDir = dataDir
    this.maxMessages = options.maxMessages ?? 120
    ensureDir(this.dataDir)
  }

  async getMessages(sessionId: string): Promise<RuntimeMessage[]> {
    const path = this.sessionPath(sessionId)
    if (!existsSync(path)) return []
    try {
      const value = JSON.parse(await readFile(path, 'utf8')) as unknown
      if (!Array.isArray(value)) return []
      return value
        .filter(isRuntimeMessage)
        .map(cloneMessage)
    } catch {
      return []
    }
  }

  async appendMessages(sessionId: string, messages: RuntimeMessage[]): Promise<void> {
    if (messages.length === 0) return

    await this.enqueueSessionWrite(sessionId, async () => {
      const current = await this.getMessages(sessionId)
      const order = current.map(message => message.id)
      const byId = new Map(current.map(message => [message.id, cloneMessage(message)]))

      for (const message of messages) {
        if (!byId.has(message.id)) {
          order.push(message.id)
        }
        byId.set(message.id, cloneMessage(message))
      }

      const next = order
        .map(id => byId.get(id))
        .filter((message): message is RuntimeMessage => Boolean(message))
        .slice(-this.maxMessages)
      await writeJsonAtomic(this.sessionPath(sessionId), next)
    })
  }

  private async enqueueSessionWrite<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.sessionQueues.get(sessionId) ?? Promise.resolve()
    const next = previous.then(task, task)
    const stored = next.catch(() => undefined)
    this.sessionQueues.set(sessionId, stored)
    try {
      return await next
    } finally {
      if (this.sessionQueues.get(sessionId) === stored) {
        this.sessionQueues.delete(sessionId)
      }
    }
  }

  private sessionPath(sessionId: string): string {
    return join(this.dataDir, `${sanitizePathSegment(sessionId)}.json`)
  }
}

function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return typeof record.id === 'string' &&
    typeof record.role === 'string' &&
    typeof record.content === 'string' &&
    isRuntimeMessageRole(record.role)
}

function isRuntimeMessageRole(role: string): role is RuntimeMessage['role'] {
  return role === 'user' || role === 'assistant' || role === 'system' || role === 'tool'
}

function cloneMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    metadata: message.metadata ? { ...message.metadata } : undefined,
  }
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmp = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  await rename(tmp, path)
}
