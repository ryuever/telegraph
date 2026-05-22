import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ObservationArtifactRef } from '@/packages/computer-use-protocol'

export interface WriteObservationArtifactInput {
  runId?: string
  kind: string
  mediaType: string
  bytes: Uint8Array
  title?: string
  now?: number
}

export interface ObservationArtifactStore {
  writeArtifact(input: WriteObservationArtifactInput): Promise<ObservationArtifactRef>
}

export class FileObservationArtifactStore implements ObservationArtifactStore {
  constructor(private readonly baseDir = join(process.cwd(), '.telegraph', 'computer-use-artifacts')) {}

  async writeArtifact(input: WriteObservationArtifactInput): Promise<ObservationArtifactRef> {
    const now = input.now ?? Date.now()
    const artifactId = `observation-${now.toString(36)}-${randomUUID()}`
    const extension = extensionForMediaType(input.mediaType)
    const runSegment = sanitizeSegment(input.runId ?? 'unscoped')
    const filename = `${artifactId}${extension}`
    const dir = join(this.baseDir, runSegment)
    const path = join(dir, filename)
    await mkdir(dir, { recursive: true })
    await writeFile(path, input.bytes)

    return {
      artifactId,
      uri: `telegraph://computer-use-artifacts/${runSegment}/${filename}`,
      mediaType: input.mediaType,
      title: input.title,
      sizeBytes: input.bytes.byteLength,
      sha256: createHash('sha256').update(input.bytes).digest('hex'),
    }
  }
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === 'image/png') return '.png'
  if (mediaType === 'application/json') return '.json'
  if (mediaType === 'text/plain') return '.txt'
  return '.bin'
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}
