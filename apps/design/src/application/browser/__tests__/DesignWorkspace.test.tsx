import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { DesignAgentSendOptions } from '../pagelet-design-agent-service'
import { DesignWorkspace } from '../DesignWorkspace'
import type { DesignSandpackerPreviewProps } from '../DesignSandpackerPreview'

vi.mock('../DesignSandpackerPreview', () => ({
  DesignSandpackerPreview: (props: DesignSandpackerPreviewProps) => (
    <div data-testid="sandpacker-preview">
      <button
        type="button"
        onClick={() => {
          props.onSelectComponent?.({
            id: 'patch-1:preview-dom:apps-design-src-Hero-tsx:1:1:button',
            artifactId: 'patch-1',
            label: 'Button .bg-primary',
            source: 'preview-dom',
            path: 'apps/design/src/Hero.tsx',
            elementTag: 'button',
            className: 'bg-primary text-white',
            sourceLocation: {
              filePath: 'apps/design/src/Hero.tsx',
              line: 1,
              column: 32,
            },
          })
        }}
      >
        Select preview button
      </button>
      <button
        type="button"
        onClick={() => {
          props.onOperationsChange?.([
            {
              kind: 'update',
              path: 'apps/design/src/Hero.tsx',
              content: 'export function Hero() { return <button className="bg-green-600">Go</button> }',
            },
          ])
        }}
      >
        Edit preview source
      </button>
    </div>
  ),
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const serviceMocks = vi.hoisted(() => ({
  send: vi.fn(),
  previewArtifactPatch: vi.fn(),
  applyArtifactPatch: vi.fn(),
  exportArtifact: vi.fn(),
}))

vi.mock('../pagelet-design-agent-service', () => ({
  PageletDesignAgentService: class {
    send = serviceMocks.send
    previewArtifactPatch = serviceMocks.previewArtifactPatch
    applyArtifactPatch = serviceMocks.applyArtifactPatch
    exportArtifact = serviceMocks.exportArtifact
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
    serviceMocks.exportArtifact.mockResolvedValue({
      runId: 'export-run',
      artifactId: 'patch-1',
      status: 'exported',
      artifact: {
        id: 'patch-1-export',
        kind: 'design-export',
        title: 'Hero patch export',
        sourceArtifactId: 'patch-1',
        formats: ['html-zip'],
        exports: [{ format: 'html-zip', status: 'generated', path: '/tmp/html-project.zip' }],
        manifestPath: '/tmp/export-manifest.json',
        createdAt: 1,
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
    expect(container.textContent).toContain('subagent')
    expect(container.textContent).toContain('Design Component Scout')
    expect(container.textContent).toContain('Model completed: Design Component Scout')
    expect(container.textContent).toContain('components: Button')
    expect(container.textContent).not.toContain('正在生成...')

    expect(container.textContent).toContain('Intent Brief')
    expect(container.textContent).toContain('Design Component Scout')
    expect(container.textContent).toContain('selected 1')

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

  it('lays run details directly in the conversation stream', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<DesignWorkspace initialPrompt="make a hero" />)
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Intent Brief')
    expect(container.textContent).toContain('Model completed: Design Component Scout')
    expect(container.querySelector('details')?.textContent).toContain('1 subagents')
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

  it('passes edited patch operation summaries into follow-up design runs', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<DesignWorkspace initialPrompt="make a hero" />)
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByText(container, 'Edit preview source')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).not.toBeNull()

    await act(async () => {
      if (!textarea) return
      setTextAreaValue(textarea, 'make it more compact')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByText(container, '发送')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(serviceMocks.send).toHaveBeenCalledTimes(2)
    const secondSend = serviceMocks.send.mock.calls[1]?.[0] as DesignAgentSendOptions | undefined
    const activeArtifact = recordField(secondSend?.context, 'activeArtifact')
    expect(activeArtifact).toMatchObject({
      id: 'patch-1',
      operationPaths: ['apps/design/src/Hero.tsx'],
    })
    const operationSummary = recordValue(arrayField(activeArtifact, 'operationSummaries')[0])
    expect(operationSummary).toMatchObject({
      kind: 'update',
      path: 'apps/design/src/Hero.tsx',
    })
    expect(stringField(operationSummary, 'contentPreview')).toContain('bg-green-600')
    expect(numberField(operationSummary, 'contentLength')).toBeGreaterThan(0)
  })

  it('passes component edit context with dirty source into follow-up design runs', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<DesignWorkspace initialPrompt="make a hero" />)
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByText(container, 'Select preview button')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      findButtonByText(container, 'Edit preview source')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const textarea = container.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).not.toBeNull()

    await act(async () => {
      if (!textarea) return
      setTextAreaValue(textarea, 'make the button green and bigger')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByText(container, '发送')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    const secondSend = serviceMocks.send.mock.calls[1]?.[0] as DesignAgentSendOptions | undefined
    const componentEdit = recordField(secondSend?.context, 'componentEdit')
    expect(componentEdit).toMatchObject({
      kind: 'component-edit',
      artifactId: 'patch-1',
      prompt: 'make the button green and bigger',
      dirtyOperationPaths: ['apps/design/src/Hero.tsx'],
    })
    expect(recordField(componentEdit, 'target')).toMatchObject({
      source: 'preview-dom',
      elementTag: 'button',
      path: 'apps/design/src/Hero.tsx',
    })
    expect(recordField(componentEdit, 'binding')).toMatchObject({
      editScope: 'composition',
      preferredOperationPath: 'apps/design/src/Hero.tsx',
    })
    expect(recordValue(arrayField(componentEdit, 'dirtyOperations')[0])).toMatchObject({
      source: 'style-editor',
      path: 'apps/design/src/Hero.tsx',
    })
  })

  it('exports the active artifact and keeps the export artifact in the workbench', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<DesignWorkspace initialPrompt="make a hero" />)
      await Promise.resolve()
    })

    await act(async () => {
      container
        ?.querySelector<HTMLButtonElement>('button[aria-label="Export HTML ZIP"]')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(serviceMocks.exportArtifact).toHaveBeenCalledWith(expect.objectContaining({
      artifactId: 'patch-1',
      formats: ['html-zip'],
    }))
    expect(container.textContent).toContain('已导出 html-zip。')
    expect(container.textContent).toContain('Hero patch export')
  })
})

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}

function arrayField(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const field = (value as Record<string, unknown>)[key]
  return Array.isArray(field) ? field : []
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'number' ? field : undefined
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
