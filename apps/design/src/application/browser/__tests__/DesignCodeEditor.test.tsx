import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesignCodeEditor } from '../DesignCodeEditor'

vi.mock('@monaco-editor/react', () => ({
  default: (props: { value?: string; language?: string; options?: Record<string, unknown> }) => {
    const readOnly = props.options?.readOnly
    return (
      <div
        data-testid="monaco-editor"
        data-language={props.language}
        data-readonly={typeof readOnly === 'boolean' ? String(readOnly) : 'false'}
      >
        {props.value}
      </div>
    )
  },
}))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

describe('DesignCodeEditor', () => {
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

  it('renders file tree with operations and shows first file in Monaco editor', () => {
    const operations = [
      { kind: 'add' as const, path: 'src/components/Button.tsx', content: 'export function Button() { return <button /> }' },
      { kind: 'update' as const, path: 'src/App.tsx', content: 'export function App() { return <div /> }' },
      { kind: 'delete' as const, path: 'src/old/Removed.tsx' },
    ]

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(<DesignCodeEditor operations={operations} />)
    })

    // Should show file tree with 2 files (delete operations without content are excluded)
    expect(container.textContent).toContain('Button.tsx')
    expect(container.textContent).toContain('App.tsx')
    expect(container.textContent).not.toContain('Removed.tsx')

    // Should show directories
    expect(container.textContent).toContain('src')
    expect(container.textContent).toContain('components')

    // Should show file count
    expect(container.textContent).toContain('(2)')

    // Monaco editor should show the first file's content
    const editor = container.querySelector('[data-testid="monaco-editor"]')
    expect(editor?.textContent).toContain('Button')
    expect(editor?.getAttribute('data-language')).toBe('typescript')
    expect(editor?.getAttribute('data-readonly')).toBe('true')
  })

  it('switches active file when clicking a file in the tree', () => {
    const operations = [
      { kind: 'add' as const, path: 'src/index.ts', content: 'console.log("index")' },
      { kind: 'update' as const, path: 'src/App.ts', content: 'export function App() {}' },
    ]
    const onSelectFile = vi.fn()

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(<DesignCodeEditor operations={operations} onSelectFile={onSelectFile} />)
    })

    // Default shows first file (alphabetically sorted: App.ts before index.ts)
    const editor = container.querySelector('[data-testid="monaco-editor"]')
    expect(editor?.textContent).toContain('App')

    // Click the second file
    act(() => {
      const indexButton = findButtonByText(container, 'index.ts')
      indexButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(onSelectFile).toHaveBeenCalledWith('src/index.ts')

    // Editor should now show the index.ts content
    const updatedEditor = container.querySelector('[data-testid="monaco-editor"]')
    expect(updatedEditor?.textContent).toContain('index')
    expect(updatedEditor?.getAttribute('data-language')).toBe('typescript')
  })

  it('shows empty state when there are no files with content', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(<DesignCodeEditor operations={[]} />)
    })

    expect(container.textContent).toContain('No files to display')
  })

  it('uses selectedPath prop to set initial active file', () => {
    const operations = [
      { kind: 'add' as const, path: 'src/first.tsx', content: 'export const First = () => <></>' },
      { kind: 'add' as const, path: 'src/second.tsx', content: 'export const Second = () => <></>' },
    ]

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(<DesignCodeEditor operations={operations} selectedPath="src/second.tsx" />)
    })

    const editor = container.querySelector('[data-testid="monaco-editor"]')
    expect(editor?.textContent).toContain('Second')
  })

  it('falls back to code prop when operations are empty', () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <DesignCodeEditor code='<div>Hello</div>' codePath="index.html" />,
      )
    })

    // Single file: sidebar is collapsed by default, editor shows the code
    const editor = container.querySelector('[data-testid="monaco-editor"]')
    expect(editor?.textContent).toContain('Hello')
    expect(editor?.getAttribute('data-language')).toBe('html')

    // File path shown in the header
    expect(container.textContent).toContain('index.html')

    // Expand button should be visible
    expect(container.querySelector('button[aria-label="Expand file tree"]')).toBeTruthy()
  })

  it('prioritizes operations over code prop', () => {
    const operations = [
      { kind: 'add' as const, path: 'src/A.ts', content: 'export const A = 1' },
    ]

    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)

    act(() => {
      root?.render(
        <DesignCodeEditor
          operations={operations}
          code="fallback content"
          codePath="fallback.ts"
        />,
      )
    })

    const editor = container.querySelector('[data-testid="monaco-editor"]')
    expect(editor?.textContent).toContain('A = 1')
    expect(editor?.textContent).not.toContain('fallback')
  })
})

function findButtonByText(container: HTMLElement | undefined, text: string): HTMLButtonElement | undefined {
  return [...(container?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    .find(button => button.textContent.includes(text))
}
