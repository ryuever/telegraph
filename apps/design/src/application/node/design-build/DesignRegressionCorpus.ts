import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { DesignExportablePatchArtifact } from '@/apps/design/application/common/design-export-contract'
import { evaluateDesignBuildArtifact } from './DesignBuildReviewPolicy'
import type { DesignPatchArtifact } from './DesignBuildArtifacts'

export interface DesignCorpusFixture {
  id: string
  prompt: string
  artifact: DesignExportablePatchArtifact
  metrics?: Record<string, unknown>
  recordedAt: number
}

export interface DesignCorpusReplayResult {
  fixtureId: string
  status: 'pass' | 'repair_required' | 'blocked'
  failedChecks: string[]
}

export class DesignRegressionCorpus {
  constructor(private readonly rootDir = join(process.cwd(), '.telegraph', 'design-corpus')) {}

  async recordFixture(input: Omit<DesignCorpusFixture, 'recordedAt'> & { recordedAt?: number }): Promise<string> {
    await mkdir(this.rootDir, { recursive: true })
    const fixture: DesignCorpusFixture = {
      ...input,
      recordedAt: input.recordedAt ?? Date.now(),
    }
    const path = join(this.rootDir, `${safeSegment(fixture.id)}.json`)
    await writeFile(path, `${JSON.stringify(fixture, null, 2)}\n`, 'utf8')
    return path
  }

  async listFixtures(): Promise<DesignCorpusFixture[]> {
    await mkdir(this.rootDir, { recursive: true })
    const entries = await readdir(this.rootDir)
    const fixtures: DesignCorpusFixture[] = []
    for (const entry of entries.filter(name => name.endsWith('.json')).sort()) {
      const parsed = JSON.parse(await readFile(join(this.rootDir, entry), 'utf8')) as unknown
      if (isCorpusFixture(parsed)) fixtures.push(parsed)
    }
    return fixtures
  }

  async replayFixtures(): Promise<DesignCorpusReplayResult[]> {
    const fixtures = await this.listFixtures()
    return fixtures.map(fixture => {
      const review = evaluateDesignBuildArtifact(toPatchArtifact(fixture.artifact))
      return {
        fixtureId: fixture.id,
        status: review.verdict,
        failedChecks: review.checks.filter(check => !check.passed).map(check => check.id),
      }
    })
  }
}

function toPatchArtifact(artifact: DesignExportablePatchArtifact): DesignPatchArtifact {
  return {
    id: artifact.id,
    kind: 'design-patch',
    title: artifact.title ?? artifact.id,
    revision: artifact.revision,
    metadata: artifact.metadata,
    operations: artifact.operations,
  }
}

function isCorpusFixture(value: unknown): value is DesignCorpusFixture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<DesignCorpusFixture>
  return typeof record.id === 'string' &&
    typeof record.prompt === 'string' &&
    Boolean(record.artifact) &&
    typeof record.artifact === 'object' &&
    !Array.isArray(record.artifact) &&
    typeof record.recordedAt === 'number'
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-')
}
