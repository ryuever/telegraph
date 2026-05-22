import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { DesignAgentSendOptions } from '../pagelet-design-agent-service'
import { DesignWorkspace } from '../DesignWorkspace'

vi.mock('../DesignSandpackerPreview', () => ({
  DesignSandpackerPreview: () => <div data-testid="sandpacker-preview" />,
}))

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
      options.onTraceEvent?.({
        type: 'agent_event',
        runId: 'mock-run',
        event: {
          type: 'step_started',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          runId: 'mock-run',
          stepId: 'mock-run:brief',
          label: 'Intent Brief',
          ts: 1,
        },
      })
      options.onTraceEvent?.({
        type: 'agent_event',
        runId: 'mock-run',
        event: {
          type: 'child_run_started',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          parentRunId: 'mock-run',
          childRunId: 'mock-run:design-component-scout',
          label: 'Design Component Scout',
          ts: 2,
        },
      })
      options.onTraceEvent?.({
        type: 'agent_event',
        runId: 'mock-run',
        event: {
          type: 'child_run_completed',
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          parentRunId: 'mock-run',
          childRunId: 'mock-run:design-component-scout',
          output: {
            components: [{ name: 'Button' }],
          },
          ts: 3,
        },
      })
      options.onArtifact?.({
        id: 'patch-1',
        kind: 'design-patch',
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

  it('offers a way back to the design entry', async () => {
    const onReturnToEntry = vi.fn()
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<DesignWorkspace initialPrompt="make a hero" onReturnToEntry={onReturnToEntry} />)
      await Promise.resolve()
    })

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Back to design entry"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(onReturnToEntry).toHaveBeenCalledTimes(1)
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
    expect(container.textContent).toContain('已生成「Hero patch」预览。')
    expect(container.textContent).toContain('Subagents')
    expect(container.textContent).toContain('Design Component Scout')
    expect(container.textContent).not.toContain('正在生成...')

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Toggle build progress"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Intent Brief')
    expect(container.textContent).toContain('Design Component Scout')
    expect(container.textContent).toContain('1 components')

    await act(async () => {
      applyButton()?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(serviceMocks.previewArtifactPatch).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'patch-1',
      operations: [{ kind: 'update', path: 'apps/design/src/Hero.tsx', content: 'next' }],
    }))
    expect(container.textContent).not.toContain('/repo/apps/design/src/Hero.tsx')
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

  it('closes the build progress dropdown when clicking outside', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<DesignWorkspace initialPrompt="make a hero" />)
      await Promise.resolve()
    })

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-label="Toggle build progress"]')
    expect(toggle).not.toBeNull()

    await act(async () => {
      toggle?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(toggle?.getAttribute('aria-expanded')).toBe('true')
    expect(container.textContent).toContain('Build progress')

    await act(async () => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
      await Promise.resolve()
    })

    expect(toggle?.getAttribute('aria-expanded')).toBe('false')
    expect(container.textContent).not.toContain('Build progress')
  })

  it('passes active artifact context into follow-up design runs', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<DesignWorkspace initialPrompt="make a hero" />)
      await Promise.resolve()
    })

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Inspect selected component"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByText(container, 'apps/design/src/Hero.tsx')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).not.toBeNull()

    await act(async () => {
      if (!textarea) return
      setTextAreaValue(textarea, 'make the button green')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByText(container, '发送')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(serviceMocks.send).toHaveBeenCalledTimes(2)
    const secondSend = serviceMocks.send.mock.calls[1]?.[0] as DesignAgentSendOptions | undefined
    expect(secondSend?.prompt).toBe('make the button green')

    const context = secondSend?.context
    const activeArtifact = recordField(context, 'activeArtifact')
    const selectedComponent = recordField(context, 'selectedComponent')
    expect(activeArtifact).toMatchObject({
      id: 'patch-1',
      kind: 'design-patch',
      operationPaths: ['apps/design/src/Hero.tsx'],
    })
    expect(selectedComponent).toMatchObject({
      artifactId: 'patch-1',
      label: 'Hero',
      operationKind: 'update',
      path: 'apps/design/src/Hero.tsx',
    })
  })
})

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    ?.set
    ?.call(textarea, value)
}

function findButtonByText(container: HTMLElement | undefined, text: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find(button => button.textContent.includes(text))
}
