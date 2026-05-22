import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DeviceBinding, RemoteActorSnapshot } from '@/packages/remote-protocol'

export class RemoteControlDeviceBindingRepository {
  private readonly filePath: string

  constructor(dataDir = join(process.cwd(), '.telegraph', 'remote-control')) {
    this.filePath = join(dataDir, 'device-bindings.json')
  }

  async load(): Promise<DeviceBinding[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isDeviceBinding)
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  }

  async save(bindings: DeviceBinding[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, `${JSON.stringify(bindings, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
  }
}

function isDeviceBinding(value: unknown): value is DeviceBinding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<DeviceBinding>
  return typeof record.bindingId === 'string' &&
    typeof record.deviceId === 'string' &&
    isRemoteActor(record.actor) &&
    isDeviceBindingStatus(record.status) &&
    typeof record.createdAt === 'number' &&
    typeof record.updatedAt === 'number'
}

function isRemoteActor(value: unknown): value is RemoteActorSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<RemoteActorSnapshot>
  return typeof record.actorId === 'string' && typeof record.kind === 'string'
}

function isDeviceBindingStatus(value: unknown): value is DeviceBinding['status'] {
  return value === 'pending' || value === 'active' || value === 'revoked' || value === 'expired'
}

function isNotFound(error: unknown): boolean {
  return !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
}
