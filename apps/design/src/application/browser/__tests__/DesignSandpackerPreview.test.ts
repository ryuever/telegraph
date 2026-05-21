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
        path: 'apps/design/src/LoginPage.tsx',
        content: 'export default function LoginPage() { return <main>Login</main> }',
      },
    ], 'Login page')

    expect(result.files['/index.html']).toContain('src="./src/index.tsx?entry"')
    expect(result.files['/index.html']).not.toContain('src="/src/index.tsx?entry"')
  })

  it('keeps the shared UI stub typed with TSX generics', () => {
    const result = createSandpackerFiles([], 'Empty preview')
    const uiStub = result.files['/src/telegraph-ui.tsx']

    expect(uiStub).toContain('type ElementProps<Tag extends keyof React.JSX.IntrinsicElements>')
    expect(uiStub).toContain("ElementProps<'textarea'>")
    expect(uiStub).toContain('Array<string | false | null | undefined>')
    expect(uiStub).toContain('export function Textarea')
  })

  it('injects shared UI stubs when generated code uses Textarea without an import', () => {
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

    expect(source).toContain("Textarea } from '/src/telegraph-ui.tsx'")
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
})
