import { mkdtemp } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { DesignRegressionCorpus } from '../DesignRegressionCorpus'

describe('DesignRegressionCorpus', () => {
  it('records successful artifacts and replays deterministic contract checks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'telegraph-design-corpus-'))
    const corpus = new DesignRegressionCorpus(root)

    await corpus.recordFixture({
      id: 'fixture-1',
      prompt: 'Create a landing page',
      recordedAt: 123,
      artifact: {
        id: 'artifact-1',
        kind: 'design-patch',
        title: 'Landing',
        operations: [
          {
            kind: 'add',
            path: 'apps/design/src/generated/landing/package.json',
            content: JSON.stringify({
              dependencies: {
                react: '19.1.0',
                'react-dom': '19.1.0',
              },
            }),
          },
          {
            kind: 'add',
            path: 'apps/design/src/generated/landing/index.html',
            content: '<div id="root"></div><script type="module" src="./src/index.tsx?entry"></script>',
          },
          {
            kind: 'add',
            path: 'apps/design/src/generated/landing/src/index.tsx',
            content: "import App from './App'\n",
          },
          {
            kind: 'add',
            path: 'apps/design/src/generated/landing/src/App.tsx',
            content: 'export default function App() { return <main>Landing</main> }',
          },
        ],
      },
    })

    const fixtures = await corpus.listFixtures()
    expect(fixtures).toHaveLength(1)
    expect(fixtures[0]?.prompt).toBe('Create a landing page')

    const replay = await corpus.replayFixtures()
    expect(replay).toEqual([
      {
        fixtureId: 'fixture-1',
        status: 'pass',
        failedChecks: [],
      },
    ])
  })
})
