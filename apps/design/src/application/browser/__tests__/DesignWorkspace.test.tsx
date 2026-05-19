import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesignAgentSendOptions } from '../pagelet-design-agent-service'
import { DesignWorkspace } from '../DesignWorkspace'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const serviceMocks = vi.hoisted(() => ({
  send: vi.fn(),
  previewArtifactPatch: vi.fn(),
  applyArtifactPatch: vi.fn(),
}))

vi.mock('../pagelet-design-agent-service', () => ({
  PageletDesignAgentService: class {
    send = serviceMocks.send
    previewArtifactPatch = serviceMocks.previewArtifactPatch
    applyArtifactPatch = serviceMocks.applyArtifactPatch
  },
}))

describe('DesignWorkspace', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  beforeEach(() => {
    vi.clearAllMocks()
    serviceMocks.send.mockImplementation((options: DesignAgentSendOptions) => {
      options.onStatus?.('running')
      options.onArtifact?.({
        id: 'patch-1',
        kind: 'canvas_patch',
        title: 'Hero patch',
        sourceEventType: 'tool_result',
        output: {
          operations: [
            { kind: 'update', path: 'apps/design/src/Hero.tsx', content: 'next' },
          ],
        },
      })
      options.onStatus?.('completed')
      return Promise.resolve()
    })
    serviceMocks.previewArtifactPatch.mockResolvedValue({
      runId: 'preview-run',
      artifactId: 'patch-1',
      status: 'previewed',
      preview: {
        operations: [
          { kind: 'update', path: '/repo/apps/design/src/Hero.tsx', content: 'next' },
        ],
        summary: { adds: 0, updates: 1, deletes: 0 },
      },
    })
    serviceMocks.applyArtifactPatch.mockResolvedValue({
      runId: 'apply-run',
      artifactId: 'patch-1',
      status: 'applied',
      applied: true,
      preview: {
        operations: [
          { kind: 'update', path: '/repo/apps/design/src/Hero.tsx', content: 'next' },
        ],
        summary: { adds: 0, updates: 1, deletes: 0 },
      },
    })
  })

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

  it('previews and confirms patch artifact application from the workspace', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<DesignWorkspace initialPrompt="make a hero" />)
      await Promise.resolve()
    })

    const applyButton = () =>
      container?.querySelector<HTMLButtonElement>('button[aria-label="Apply artifact"]')

    expect(applyButton()?.textContent).toContain('预览 Patch')

    await act(async () => {
      applyButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(serviceMocks.previewArtifactPatch).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'patch-1',
      operations: [{ kind: 'update', path: 'apps/design/src/Hero.tsx', content: 'next' }],
    }))
    expect(container.textContent).toContain('/repo/apps/design/src/Hero.tsx')
    expect(applyButton()?.textContent).toContain('确认应用')

    await act(async () => {
      applyButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(serviceMocks.applyArtifactPatch).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'patch-1',
    }))
    expect(applyButton()?.textContent).toContain('已应用')
  })
})
