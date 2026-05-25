import { describe, expect, it } from 'vitest'
import { createDesignArtifactViewModel, extractDesignPatchOperations } from '../design-artifact-view'
import type { DesignProjectedArtifact } from '../design-agent-projector'

describe('createDesignArtifactViewModel', () => {
  it('renders html artifacts as iframe-ready previews', () => {
    const model = createDesignArtifactViewModel(artifact({
      kind: 'component',
      output: {
        id: 'hero',
        kind: 'component',
        title: 'Hero',
        html: '<section><h1>Hello</h1></section>',
      },
    }))

    expect(model).toMatchObject({
      title: 'Hero',
      kind: 'component',
      viewKind: 'html',
      previewHtml: '<section><h1>Hello</h1></section>',
      code: '<section><h1>Hello</h1></section>',
    })
  })

  it('renders design-preview artifacts as iframe-ready previews', () => {
    const model = createDesignArtifactViewModel(artifact({
      kind: 'design-preview',
      output: {
        id: 'preview-1',
        kind: 'design-preview',
        title: 'Dashboard preview',
        html: '<main><h1>Dashboard</h1></main>',
        prompt: 'Create a dashboard',
      },
    }))

    expect(model).toMatchObject({
      title: 'Dashboard preview',
      kind: 'design-preview',
      viewKind: 'html',
      previewHtml: '<main><h1>Dashboard</h1></main>',
    })
  })

  it('summarizes structured patch artifacts', () => {
    const model = createDesignArtifactViewModel(artifact({
      kind: 'canvas_patch',
      output: {
        artifactId: 'patch-1',
        artifactKind: 'canvas_patch',
        operations: [
          { kind: 'add', path: 'a.tsx', content: 'a' },
          { kind: 'update', path: 'b.tsx', content: 'b' },
          { kind: 'delete', path: 'c.tsx' },
        ],
      },
    }))

    expect(model.viewKind).toBe('patch')
    expect(model.patchSummary).toEqual({ adds: 1, updates: 1, deletes: 1 })
    expect(model.code).toContain('// ADD a.tsx')
    expect(model.code).toContain('// UPDATE b.tsx')
    expect(model.code).toContain('// DELETE c.tsx')
  })

  it('summarizes design-patch artifacts', () => {
    const model = createDesignArtifactViewModel(artifact({
      kind: 'design-patch',
      output: {
        id: 'patch-1',
        kind: 'design-patch',
        title: 'Create dashboard files',
        operations: [
          { kind: 'add', path: 'dashboard.tsx', content: 'dashboard' },
          { kind: 'update', path: 'index.tsx', content: 'index' },
        ],
      },
    }))

    expect(model.viewKind).toBe('patch')
    expect(model.patchSummary).toEqual({ adds: 1, updates: 1, deletes: 0 })
    expect(model.code).toContain('// ADD dashboard.tsx')
    expect(model.code).toContain('dashboard')
  })

  it('uses artifact virtual files as preview patch operations', () => {
    const model = createDesignArtifactViewModel(artifact({
      kind: 'design-patch',
      output: {
        id: 'profile-page',
        kind: 'design-patch',
        title: 'Profile page',
        files: {
          '/package.json': '{"dependencies":{"react":"19.1.0"}}',
          '/src/App.tsx': 'export default function App() { return <main>Profile</main> }',
        },
      },
    }))

    expect(model.viewKind).toBe('patch')
    expect(model.patchSummary).toEqual({ adds: 2, updates: 0, deletes: 0 })
    expect(extractDesignPatchOperations(artifact({
      kind: 'design-patch',
      output: {
        files: {
          '/package.json': '{"dependencies":{"react":"19.1.0"}}',
          '/src/App.tsx': 'export default function App() { return <main>Profile</main> }',
        },
      },
    }))).toEqual([
      { kind: 'add', path: 'package.json', content: '{"dependencies":{"react":"19.1.0"}}' },
      { kind: 'add', path: 'src/App.tsx', content: 'export default function App() { return <main>Profile</main> }' },
    ])
  })

  it('prefers artifact files over stale operations when both are present', () => {
    expect(extractDesignPatchOperations(artifact({
      kind: 'design-patch',
      output: {
        files: {
          '/src/App.tsx': 'fresh artifact file',
        },
        operations: [
          { kind: 'add', path: 'src/App.tsx', content: 'stale operation' },
        ],
      },
    }))).toEqual([
      { kind: 'add', path: 'src/App.tsx', content: 'fresh artifact file' },
    ])
  })

  it('extracts valid patch operations and rejects malformed operations', () => {
    expect(extractDesignPatchOperations(artifact({
      kind: 'canvas_patch',
      output: {
        operations: [
          { kind: 'update', path: 'b.tsx', content: 'b', expectedOriginal: 'a' },
        ],
      },
    }))).toEqual([
      { kind: 'update', path: 'b.tsx', content: 'b', expectedOriginal: 'a' },
    ])

    expect(extractDesignPatchOperations(artifact({
      kind: 'canvas_patch',
      output: {
        operations: [
          { kind: 'update', content: 'missing path' },
        ],
      },
    }))).toBeNull()
  })
})

function artifact(input: {
  kind: string
  output: unknown
}): DesignProjectedArtifact {
  return {
    id: 'artifact-1',
    kind: input.kind,
    output: input.output,
    sourceEventType: 'tool_result',
  }
}
