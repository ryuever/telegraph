import { mkdtemp, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { DesignExportPipeline } from '../DesignExportPipeline'

describe('DesignExportPipeline', () => {
  it('exports a design patch as HTML ZIP, PDF, and PPTX artifacts with source lineage', async () => {
    const outputRoot = await mkdtemp(join(tmpdir(), 'telegraph-design-export-'))
    const pipeline = new DesignExportPipeline({
      outputRoot,
      now: () => 123,
    })

    const artifact = await pipeline.exportArtifact({
      runId: 'run-export',
      formats: ['html-zip', 'pdf', 'pptx'],
      artifact: {
        id: 'artifact-1',
        kind: 'design-patch',
        title: 'Landing page',
        revision: 2,
        metadata: {
          designSystem: {
            themePack: { id: 'studio-dark' },
          },
        },
        operations: [
          {
            kind: 'add',
            path: 'apps/design/src/generated/landing/package.json',
            content: '{"dependencies":{"react":"19.1.0"}}',
          },
          {
            kind: 'add',
            path: 'apps/design/src/generated/landing/src/App.tsx',
            content: 'export default function App() { return <main>Landing</main> }',
          },
        ],
      },
    })

    expect(artifact).toMatchObject({
      kind: 'design-export',
      sourceArtifactId: 'artifact-1',
      sourceProjectRoot: 'apps/design/src/generated/landing',
      formats: ['html-zip', 'pdf', 'pptx'],
      themePackId: 'studio-dark',
    })
    expect(artifact.exports.every(entry => entry.status === 'generated')).toBe(true)

    const htmlZip = artifact.exports.find(entry => entry.format === 'html-zip')
    const pdf = artifact.exports.find(entry => entry.format === 'pdf')
    const pptx = artifact.exports.find(entry => entry.format === 'pptx')
    expect(htmlZip?.path).toBeTruthy()
    expect(pdf?.path).toBeTruthy()
    expect(pptx?.path).toBeTruthy()

    expect((await stat(artifact.manifestPath)).isFile()).toBe(true)
    expect((await readFile(htmlZip?.path ?? '')).subarray(0, 4).toString('hex')).toBe('504b0304')
    expect((await readFile(pdf?.path ?? '')).subarray(0, 8).toString()).toBe('%PDF-1.4')
    expect((await readFile(pptx?.path ?? '')).subarray(0, 4).toString('hex')).toBe('504b0304')
  })
})
