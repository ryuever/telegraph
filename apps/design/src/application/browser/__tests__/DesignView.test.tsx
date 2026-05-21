import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DesignView } from '../DesignView'

const workspaceLifecycle = vi.hoisted(() => ({
  mounts: 0,
  unmounts: 0,
}))

vi.mock('../DesignWorkspace', () => ({
  DesignWorkspace: ({
    initialPrompt,
    sessionId,
    onReturnToEntry,
    onSessionUpdate,
  }: {
    initialPrompt: string
    sessionId?: string
    onReturnToEntry?: () => void
    onSessionUpdate?: (sessionId: string, summary: { status: 'running' | 'completed' | 'failed' | 'cancelled'; artifactCount: number }) => void
  }) => {
    const [edits, setEdits] = React.useState(0)
    React.useEffect(() => {
      workspaceLifecycle.mounts += 1
      return () => {
        workspaceLifecycle.unmounts += 1
      }
    }, [])
    React.useEffect(() => {
      if (!sessionId) return
      onSessionUpdate?.(sessionId, { status: 'completed', artifactCount: 1 })
    }, [onSessionUpdate, sessionId])

    return (
      <div data-testid="workspace">
        <div>Workspace: {initialPrompt}</div>
        <div>Edits {initialPrompt}: {edits}</div>
        {onReturnToEntry && (
          <button type="button" aria-label="Back to design entry" onClick={onReturnToEntry}>
            Back
          </button>
        )}
        <button type="button" onClick={() => { setEdits(current => current + 1) }}>
          Edit {initialPrompt}
        </button>
      </div>
    )
  },
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

describe('DesignView', () => {
  let container: HTMLDivElement | undefined
  let root: Root | undefined

  beforeEach(() => {
    workspaceLifecycle.mounts = 0
    workspaceLifecycle.unmounts = 0
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

  it('fills the entry prompt from a quick option', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<DesignView />)
      await Promise.resolve()
    })

    const entryPrompt = container.querySelector<HTMLTextAreaElement>('textarea')
    expect(entryPrompt).not.toBeNull()

    await act(async () => {
      findButtonByText(container, '项目任务板')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(entryPrompt?.value).toContain('项目任务管理界面')
    expect(findButtonByText(container, '生成')?.disabled).toBe(false)
  })

  it('opens multiple generated app sessions without losing each workspace state', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    await act(async () => {
      root?.render(<DesignView />)
      await Promise.resolve()
    })

    const entryPrompt = container.querySelector<HTMLTextAreaElement>('textarea')
    expect(entryPrompt).not.toBeNull()

    await act(async () => {
      if (!entryPrompt) return
      setTextAreaValue(entryPrompt, 'make a profile page')
      entryPrompt.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByText(container, '生成')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Workspace: make a profile page')
    expect(workspaceLifecycle.mounts).toBe(1)

    await act(async () => {
      findButtonByText(container, 'Edit make a profile page')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Edits make a profile page: 1')

    expect(container.textContent).toContain('New design')
    expect(container.textContent).toContain('make a profile page')
    expect(container.textContent).not.toContain('继续当前会话')
    expect(workspaceLifecycle.unmounts).toBe(0)

    await act(async () => {
      findButtonByText(container, 'New design')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(container.textContent).toContain('你想创建什么界面？')

    const secondPrompt = container.querySelector<HTMLTextAreaElement>('textarea')
    await act(async () => {
      if (!secondPrompt) return
      setTextAreaValue(secondPrompt, 'make an analytics dashboard')
      secondPrompt.dispatchEvent(new Event('input', { bubbles: true }))
      await Promise.resolve()
    })

    await act(async () => {
      findButtonByText(container, '生成')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(activeWorkspaceText(container)).toContain('Workspace: make an analytics dashboard')
    expect(workspaceLifecycle.mounts).toBe(2)

    expect(container.textContent).toContain('make a profile page')
    expect(container.textContent).toContain('make an analytics dashboard')

    await act(async () => {
      findButtonByLabelText(container, 'make a profile page')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      await Promise.resolve()
    })

    expect(activeWorkspaceText(container)).toContain('Workspace: make a profile page')
    expect(activeWorkspaceText(container)).toContain('Edits make a profile page: 1')
    expect(workspaceLifecycle.mounts).toBe(2)
    expect(workspaceLifecycle.unmounts).toBe(0)
  })
})

function setTextAreaValue(textarea: HTMLTextAreaElement, value: string): void {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
    ?.set
    ?.call(textarea, value)
}

function findButtonByText(container: HTMLElement | undefined, text: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find(button => button.textContent.includes(text))
}

function findButtonByLabelText(container: HTMLElement | undefined, text: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find(button => button.getAttribute('aria-label')?.includes(text) ?? false)
}

function activeWorkspaceText(container: HTMLElement | undefined): string {
  return container?.querySelector<HTMLElement>('.absolute.inset-0 [data-testid="workspace"]')?.textContent ?? ''
}
