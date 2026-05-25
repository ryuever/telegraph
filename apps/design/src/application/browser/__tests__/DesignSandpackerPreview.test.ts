import { describe, expect, it, vi } from 'vitest'

vi.mock('@sandpacker/core', () => ({
  SandpackerProvider: ({ children }: { children: unknown }) => children,
  useSandpacker: () => ({
    client: null,
    iframeRef: { current: null },
    error: null,
    errorDetails: null,
    selectedElement: null,
    hmrMessage: null,
  }),
}))

vi.mock('@sandpacker/worker/browser-worker-backend', () => ({
  BrowserWorkerBackendFactory: vi.fn(),
}))

vi.mock('@sandpacker/editor-service', () => ({
  editorService: {
    getCurrentFileService: () => ({
      setFiles: vi.fn(),
      setFilesFromRemote: vi.fn(),
      setFileTreeSetter: vi.fn(),
    }),
    receiveElementSelection: vi.fn(),
    reset: vi.fn(),
    setEditingMode: vi.fn(),
    setIframeRef: vi.fn(),
    setSandboxClient: vi.fn(),
    setTechStack: vi.fn(),
  },
}))

vi.mock('@sandpacker/style-editor', () => ({
  StyleEditorPanel: () => null,
}))

vi.mock('@sandpacker/worker/worker-entry?worker&url', () => ({
  default: '/sandpacker-worker-entry.js',
}))

vi.mock('@sandpacker/worker/service-worker-entry?worker&url', () => ({
  default: '/sandpacker-service-worker.js',
}))

const { createSandpackerFileTree } = await import('../DesignSandpackerPreview')

describe('createSandpackerFileTree', () => {
  it('projects generated artifact files without adding preview fallback files', () => {
    const packageJson = JSON.stringify({ dependencies: { react: '19.1.0', 'react-dom': '19.1.0' } })
    const result = createSandpackerFileTree([
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/package.json',
        content: packageJson,
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/index.html',
        content: '<div id="root"></div><script type="module" src="/src/index.tsx"></script>',
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/index.tsx',
        content: 'import "./App"',
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/App.tsx',
        content: 'export default function App() { return <main>Login</main> }',
      },
    ])

    expect(result.files['/package.json']).toBe(packageJson)
    expect(result.files).toMatchObject({
      '/index.html': '<div id="root"></div><script type="module" src="/src/index.tsx"></script>',
      '/src/index.tsx': 'import "./App"',
      '/src/App.tsx': 'export default function App() { return <main>Login</main> }',
    })
    expect(result.files['/src/Generated.tsx']).toBeUndefined()
  })

  it('remaps a generated project folder to the Sandpacker root', () => {
    const result = createSandpackerFileTree([
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/package.json',
        content: JSON.stringify({
          dependencies: {
            react: '19.1.0',
            'react-dom': '19.1.0',
            '@radix-ui/react-tabs': 'latest',
          },
        }, null, 2),
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/index.tsx',
        content: 'import "./App"',
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/App.tsx',
        content: 'export default function App() { return <main>Login</main> }',
      },
    ])

    expect(result.files['/package.json']).toContain('@radix-ui/react-tabs')
    expect(result.files['/src/index.tsx']).toBe('import "./App"')
    expect(result.files['/src/App.tsx']).toContain('Login')
    expect(result.virtualPathToOperationPath.get('/src/App.tsx'))
      .toBe('apps/design/src/generated/login-page/src/App.tsx')
  })

  it('preserves package.json content verbatim instead of normalizing dependencies', () => {
    const packageJson = JSON.stringify({
      dependencies: {
        react: '19.1.0',
        'react-dom': '19.1.0',
        '@radix-ui/react-progress': '1.2.3',
        '@radix-ui/react-slot': '^1.2.3',
        '@radix-ui/react-tabs': 'latest',
        recharts: '2.15.4',
      },
    }, null, 2)
    const result = createSandpackerFileTree([
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/package.json',
        content: packageJson,
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/App.tsx',
        content: 'export default function App() { return <main>Login</main> }',
      },
    ])

    expect(result.files['/package.json']).toBe(packageJson)
  })

  it('leaves unimported shared UI names untouched so project dependencies stay explicit', () => {
    const result = createSandpackerFileTree([
      {
        kind: 'add',
        path: 'apps/design/src/generated/FormPage.tsx',
        content: [
          'export default function FormPage() {',
          '  return <main><Textarea placeholder="Bio" /></main>',
          '}',
        ].join('\n'),
      },
    ])

    const source = result.files['/apps/design/src/generated/FormPage.tsx']

    expect(source).not.toContain('/src/telegraph-ui.tsx')
    expect(result.files['/src/telegraph-ui.tsx']).toBeUndefined()
  })

  it('preserves workspace UI imports instead of rewriting to preview stubs', () => {
    const result = createSandpackerFileTree([
      {
        kind: 'add',
        path: 'apps/design/src/generated/FormPage.tsx',
        content: [
          "import { Textarea } from '@/packages/ui/components/ui/textarea'",
          '',
          'export default function FormPage() {',
          '  return <main><Textarea placeholder="Bio" /></main>',
          '}',
        ].join('\n'),
      },
    ])

    const source = result.files['/apps/design/src/generated/FormPage.tsx']

    expect(source).toContain("@/packages/ui/components/ui/textarea")
    expect(source).not.toContain('/src/telegraph-ui.tsx')
  })

  it('preserves React hook and workspace UI imports verbatim', () => {
    const result = createSandpackerFileTree([
      {
        kind: 'add',
        path: 'apps/design/src/generated/TaskPage.tsx',
        content: [
          "import { useState } from 'react'",
          "import { Button } from '@/packages/ui/components/ui/button'",
          '',
          'export default function TaskPage() {',
          '  const [count, setCount] = useState(0)',
          '  return <Button onClick={() => setCount(count + 1)}>{count}</Button>',
          '}',
        ].join('\n'),
      },
    ])

    const source = result.files['/apps/design/src/generated/TaskPage.tsx']

    expect(source).toContain("import { useState } from 'react'")
    expect(source).toContain("@/packages/ui/components/ui/button")
    expect(source).not.toContain('/src/telegraph-ui.tsx')
  })

  it('preserves generated project alias imports for the Sandpacker Vite resolver', () => {
    const result = createSandpackerFileTree([
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/package.json',
        content: JSON.stringify({
          dependencies: {
            react: '19.1.0',
            'react-dom': '19.1.0',
          },
        }),
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/App.tsx',
        content: [
          "import { Button } from '@/components/ui/button'",
          "import { cn } from '@/lib/utils'",
          "import '@/styles.css'",
          '',
          'export default function App() {',
          '  return <Button className={cn("px-4")}>Login</Button>',
          '}',
        ].join('\n'),
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/components/ui/button.tsx',
        content: 'export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} /> }',
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/lib/utils.ts',
        content: 'export function cn(...items: string[]) { return items.join(" ") }',
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/styles.css',
        content: 'body { margin: 0 }',
      },
    ])

    const source = result.files['/src/App.tsx']

    expect(source).toContain("from '@/components/ui/button'")
    expect(source).toContain("from '@/lib/utils'")
    expect(source).toContain("import '@/styles.css'")
  })
})
