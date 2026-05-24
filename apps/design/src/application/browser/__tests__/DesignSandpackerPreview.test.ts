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

const { createSandpackerFiles } = await import('../DesignSandpackerPreview')

describe('createSandpackerFiles', () => {
  it('uses a sandbox-relative entry script so iframe requests stay under the Sandpacker route', () => {
    const result = createSandpackerFiles([
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/App.tsx',
        content: 'export default function LoginPage() { return <main>Login</main> }',
      },
    ], 'Login page')

    expect(result.files['/index.html']).toContain('src="./src/index.tsx?entry"')
    expect(result.files['/index.html']).not.toContain('src="/src/index.tsx?entry"')
  })

  it('rewrites artifact index.html absolute module entries to the Sandpacker route', () => {
    const result = createSandpackerFiles([
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/package.json',
        content: JSON.stringify({ dependencies: { react: '19.1.0', 'react-dom': '19.1.0' } }),
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
    ], 'Login page')

    expect(result.files['/index.html']).toContain('src="./src/index.tsx?entry"')
    expect(result.files['/index.html']).not.toContain('src="/src/index.tsx"')
  })

  it('rewrites absolute module entries even when src appears before type', () => {
    const result = createSandpackerFiles([
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/package.json',
        content: JSON.stringify({ dependencies: { react: '19.1.0', 'react-dom': '19.1.0' } }),
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/index.html',
        content: '<div id="root"></div><script src="/src/index.tsx?entry" type="module"></script>',
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
    ], 'Login page')

    expect(result.files['/index.html']).toContain('src="./src/index.tsx?entry"')
    expect(result.files['/index.html']).toContain('type="module"')
  })

  it('remaps a generated project folder to the Sandpacker root', () => {
    const result = createSandpackerFiles([
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
    ], 'Login page')

    expect(result.files['/package.json']).toContain('@radix-ui/react-tabs')
    expect(result.files['/src/index.tsx']).toBe('import "./App"')
    expect(result.files['/src/App.tsx']).toContain('Login')
    expect(result.virtualPathToOperationPath.get('/src/App.tsx'))
      .toBe('apps/design/src/generated/login-page/src/App.tsx')
  })

  it('pins preview React dependencies even when artifact package.json requests latest or canary', () => {
    const result = createSandpackerFiles([
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/package.json',
        content: JSON.stringify({
          dependencies: {
            react: 'latest',
            'react-dom': '19.3.0-canary-fef12a01-20260413',
          },
        }, null, 2),
      },
      {
        kind: 'add',
        path: 'apps/design/src/generated/login-page/src/App.tsx',
        content: 'export default function App() { return <main>Login</main> }',
      },
    ], 'Login page')

    expect(result.files['/package.json']).toContain('"react": "18.3.1"')
    expect(result.files['/package.json']).toContain('"react-dom": "18.3.1"')
    expect(result.files['/package.json']).not.toContain('canary')
    expect(result.files['/package.json']).not.toContain('"react": "latest"')
  })

  it('uses the bundled Tailwind browser runtime instead of the production-warning CDN', () => {
    const result = createSandpackerFiles([], 'Empty preview')

    expect(result.files['/index.html']).toContain('<script src="')
    expect(result.files['/index.html']).not.toContain('cdn.tailwindcss.com')
  })

  it('keeps the shared UI stub typed with TSX generics', () => {
    const result = createSandpackerFiles([], 'Empty preview')
    const uiStub = result.files['/src/telegraph-ui.tsx']

    expect(uiStub).toContain('type ElementProps<Tag extends keyof React.JSX.IntrinsicElements>')
    expect(uiStub).toContain("ElementProps<'textarea'>")
    expect(uiStub).toContain('Array<string | false | null | undefined>')
    expect(uiStub).toContain('export function Textarea')
  })

  it('leaves unimported shared UI names untouched so project dependencies stay explicit', () => {
    const result = createSandpackerFiles([
      {
        kind: 'add',
        path: 'apps/design/src/generated/FormPage.tsx',
        content: [
          'export default function FormPage() {',
          '  return <main><Textarea placeholder="Bio" /></main>',
          '}',
        ].join('\n'),
      },
    ], 'Form page')

    const source = result.files['/apps/design/src/generated/FormPage.tsx']

    expect(source).not.toContain('/src/telegraph-ui.tsx')
  })

  it('normalizes Textarea imports from shared UI modules', () => {
    const result = createSandpackerFiles([
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
    ], 'Form page')

    const source = result.files['/apps/design/src/generated/FormPage.tsx']

    expect(source).toContain("Textarea } from '/src/telegraph-ui.tsx'")
    expect(source).not.toContain('@/packages/ui/components/ui/textarea')
  })

  it('does not strip React hook imports when normalizing workspace UI imports', () => {
    const result = createSandpackerFiles([
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
    ], 'Task page')

    const source = result.files['/apps/design/src/generated/TaskPage.tsx']

    expect(source).toContain("import { useState } from 'react'")
    expect(source).toContain("Button,")
    expect(source).toContain("from '/src/telegraph-ui.tsx'")
    expect(source).not.toContain('@/packages/ui/components/ui/button')
  })

  it('normalizes generated project alias imports to local Sandpacker files', () => {
    const result = createSandpackerFiles([
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
    ], 'Login page')

    const source = result.files['/src/App.tsx']

    expect(source).toContain("from '/src/components/ui/button.tsx'")
    expect(source).toContain("from '/src/lib/utils.ts'")
    expect(source).toContain("import '/src/styles.css'")
    expect(source).not.toContain('@/components/ui/button')
  })
})
