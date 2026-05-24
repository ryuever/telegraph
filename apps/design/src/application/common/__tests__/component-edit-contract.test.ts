import { describe, expect, it } from 'vitest'
import {
  createComponentEditContext,
  isShadcnPrimitivePath,
} from '../component-edit-contract'

describe('component-edit-contract', () => {
  it('binds shadcn primitive selections back to a composition edit path', () => {
    const context = createComponentEditContext({
      artifactId: 'artifact-1',
      target: {
        id: 'selection-1',
        artifactId: 'artifact-1',
        label: 'Button',
        source: 'preview-dom',
        path: 'apps/design/src/generated/page/src/components/ui/button.tsx',
        elementTag: 'button',
      },
      artifactOperationPaths: [
        'apps/design/src/generated/page/src/App.tsx',
        'apps/design/src/generated/page/src/components/ui/button.tsx',
      ],
    })

    expect(context.binding.provenance).toBe('shadcn-primitive')
    expect(context.binding.editScope).toBe('composition')
    expect(context.binding.preferredOperationPath).toBe('apps/design/src/generated/page/src/App.tsx')
    expect(context.binding.protectedPrimitivePaths).toEqual([
      'apps/design/src/generated/page/src/components/ui/button.tsx',
    ])
  })

  it('tracks dirty source operations without marking app composition files as primitives', () => {
    const context = createComponentEditContext({
      artifactId: 'artifact-1',
      target: {
        id: 'selection-1',
        artifactId: 'artifact-1',
        label: 'Primary button',
        source: 'preview-dom',
        path: 'apps/design/src/generated/page/src/App.tsx',
        elementTag: 'button',
      },
      artifactOperationPaths: ['apps/design/src/generated/page/src/App.tsx'],
      dirtyOperations: [
        {
          kind: 'update',
          path: 'apps/design/src/generated/page/src/App.tsx',
          source: 'style-editor',
          contentPreview: '<Button className="bg-green-600 px-5" />',
          contentLength: 42,
        },
      ],
    })

    expect(context.dirtyOperationPaths).toEqual(['apps/design/src/generated/page/src/App.tsx'])
    expect(context.binding.provenance).toBe('composition')
    expect(isShadcnPrimitivePath(context.dirtyOperationPaths[0] ?? '')).toBe(false)
  })
})
