import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesignArtifactWorkbench } from '../DesignArtifactWorkbench'
import type { DesignProjectedArtifact } from '../design-agent-projector'

vi.mock('../DesignSandpackerPreview', () => ({
  DesignSandpackerPreview: (props: {
    onSelectComponent?: (component: {
      id: string
      artifactId: string
      label: string
      source: 'preview-dom'
      path: string
      elementTag: string
      className: string
      sourceLocation: {
        filePath: string
        line: number
        column: number
      }
    }) => void
  }) => (
    <button
      type="button"
      data-testid="sandpacker-preview"
      onClick={() => {
        props.onSelectComponent?.({
          id: 'artifact-patch:preview-dom:hero-button',
          artifactId: 'artifact-patch',
          label: 'Button .bg-primary',
          source: 'preview-dom',
          path: 'apps/design/src/Hero.tsx',
          elementTag: 'button',
          className: 'bg-primary text-white',
          sourceLocation: {
            filePath: 'apps/design/src/Hero.tsx',
            line: 12,
            column: 8,
          },
        })
      }}
    >
      Select preview node
    </button>
  ),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

describe('DesignArtifactWorkbench', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  afterEach(() => {
    if (root) {
      act(() => {
        root?.unmount()
      })
    }
    container?.remove()
    container = undefined
    root = undefined
  })

  it('previews artifacts, switches to source, selects patch artifacts, and applies active artifact', () => {
    const htmlArtifact: DesignProjectedArtifact = {
      id: 'artifact-html',
      kind: 'component',
      title: 'Landing Preview',
      sourceEventType: 'tool_result',
      output: {
        html: '<main><h1>Preview</h1></main>',
      },
    }
    const patchArtifact: DesignProjectedArtifact = {
      id: 'artifact-patch',
      kind: 'patch',
      sourceEventType: 'run_completed',
      output: {
        parentArtifactId: 'artifact-html',
        revision: 2,
        changeSummary: 'Apply requested change: add panel',
        operations: [
          { kind: 'add', path: 'apps/design/src/NewPanel.tsx' },
          { kind: 'update', path: 'apps/design/src/DesignPanel.tsx' },
        ],
      },
    }
    const onApplyArtifact = vi.fn()
    const onSelectArtifact = vi.fn()
    const onSelectComponent = vi.fn()
    const onModeChange = vi.fn()

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <DesignArtifactWorkbench
          artifacts={[htmlArtifact, patchArtifact]}
          activeArtifactId="artifact-html"
          requestedArtifactIds={new Set()}
          mode="preview"
          onSelectArtifact={onSelectArtifact}
          onModeChange={onModeChange}
          onSelectComponent={onSelectComponent}
          onApplyArtifact={onApplyArtifact}
        />
      )
    })

    const iframe = container.querySelector<HTMLIFrameElement>('iframe[title="Landing Preview"]')
    expect(iframe?.getAttribute('srcdoc')).toContain('<h1>Preview</h1>')

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="View artifact code"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onModeChange).toHaveBeenCalledWith('code')

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Inspect selected component"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onModeChange).toHaveBeenCalledWith('inspect')

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Apply artifact"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onApplyArtifact).toHaveBeenCalledWith(htmlArtifact)

    act(() => {
      container
        ?.querySelectorAll<HTMLButtonElement>('aside button')
        .item(1)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSelectArtifact).toHaveBeenCalledWith('artifact-patch')

    act(() => {
      root?.render(
        <DesignArtifactWorkbench
          artifacts={[htmlArtifact, patchArtifact]}
          activeArtifactId="artifact-patch"
          requestedArtifactIds={new Set()}
          applyStates={new Map([['artifact-patch', { stage: 'applied' }]])}
          mode="preview"
          onSelectArtifact={onSelectArtifact}
          onModeChange={onModeChange}
          onSelectComponent={onSelectComponent}
          onApplyArtifact={onApplyArtifact}
        />
      )
    })

    expect(container.textContent).toContain('Add1')
    expect(container.textContent).toContain('Update1')
    expect(container.textContent).toContain('Delete0')
    expect(container.textContent).toContain('rev 2')
    expect(container.textContent).toContain('parent artifact-html')
    expect(container.textContent).toContain('Apply requested change: add panel')

    act(() => {
      findButtonByText(container, 'apps/design/src/NewPanel.tsx')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSelectComponent).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'artifact-patch',
      label: 'NewPanel',
      operationKind: 'add',
      path: 'apps/design/src/NewPanel.tsx',
      source: 'patch-operation',
    }))

    act(() => {
      container
        ?.querySelector<HTMLButtonElement>('[data-testid="sandpacker-preview"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSelectComponent).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'artifact-patch',
      className: 'bg-primary text-white',
      elementTag: 'button',
      label: 'Button .bg-primary',
      path: 'apps/design/src/Hero.tsx',
      source: 'preview-dom',
      sourceLocation: {
        filePath: 'apps/design/src/Hero.tsx',
        line: 12,
        column: 8,
      },
    }))

    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Apply artifact"]')?.disabled,
    ).toBe(true)
  })
})

function findButtonByText(container: HTMLElement | undefined, text: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find(button => button.textContent.includes(text))
}
