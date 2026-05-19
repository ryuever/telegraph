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
    expect(model.code).toContain('"operations"')
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
