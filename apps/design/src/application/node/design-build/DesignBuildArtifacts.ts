import { TAILWIND_PLAY_CDN_SCRIPT_URL } from '@/apps/design/application/common/design-project-contract'

export interface DesignBrief {
  prompt: string
  summary: string
  acceptanceCriteria: string[]
}

export interface DesignPreviewArtifact {
  id: string
  kind: 'design-preview'
  title: string
  html: string
  prompt: string
}

export interface DesignPatchOperation {
  path: string
  kind: 'add' | 'update' | 'delete'
  content?: string
  expectedOriginal?: string
}

export interface DesignPatchArtifact {
  id: string
  kind: 'design-patch'
  title: string
  parentArtifactId?: string
  revision?: number
  changeSummary?: string
  metadata?: Record<string, unknown>
  operations: DesignPatchOperation[]
}

export type DesignBuildArtifact = DesignPreviewArtifact | DesignPatchArtifact

export function isDesignPreviewArtifact(value: unknown): value is DesignPreviewArtifact {
  if (!isRecord(value)) return false
  return value.kind === 'design-preview' &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    typeof value.html === 'string' &&
    typeof value.prompt === 'string'
}

export function isDesignPatchArtifact(value: unknown): value is DesignPatchArtifact {
  if (!isRecord(value)) return false
  return value.kind === 'design-patch' &&
    typeof value.id === 'string' &&
    typeof value.title === 'string' &&
    Array.isArray(value.operations) &&
    value.operations.every(isDesignPatchOperation)
}

export function isDesignBuildArtifact(value: unknown): value is DesignBuildArtifact {
  return isDesignPreviewArtifact(value) || isDesignPatchArtifact(value)
}

export function createTemplateDesignPreviewArtifact(input: {
  runId: string
  prompt: string
}): DesignPreviewArtifact {
  const title = titleFromPrompt(input.prompt)
  return {
    id: `${input.runId}-preview`,
    kind: 'design-preview',
    title,
    prompt: input.prompt,
    html: renderPreviewHtml({
      title,
      prompt: input.prompt,
    }),
  }
}

export function createTemplateDesignPatchArtifact(input: {
  runId: string
  prompt: string
  parentArtifactId?: string
  revision?: number
  changeSummary?: string
}): DesignPatchArtifact {
  const title = titleFromPrompt(input.prompt)
  const slug = slugFromPrompt(input.prompt)
  const projectRoot = `apps/design/src/generated/${slug}`
  return {
    id: `${input.runId}-patch`,
    kind: 'design-patch',
    title: input.parentArtifactId ? `${title} revision` : `${title} source`,
    parentArtifactId: input.parentArtifactId,
    revision: input.revision,
    changeSummary: input.changeSummary,
    operations: [
      {
        kind: 'add',
        path: `${projectRoot}/package.json`,
        content: renderPackageJson(slug),
      },
      {
        kind: 'add',
        path: `${projectRoot}/index.html`,
        content: renderProjectIndexHtml(title),
      },
      {
        kind: 'add',
        path: `${projectRoot}/vite.config.ts`,
        content: renderViteConfig(),
      },
      {
        kind: 'add',
        path: `${projectRoot}/src/index.tsx`,
        content: renderEntrySource(),
      },
      {
        kind: 'add',
        path: `${projectRoot}/src/App.tsx`,
        content: renderTsxSource({
          componentName: componentNameFromSlug(slug),
          title,
          prompt: input.prompt,
        }),
      },
      {
        kind: 'add',
        path: `${projectRoot}/src/styles.css`,
        content: renderProjectStyles(),
      },
    ],
  }
}

function titleFromPrompt(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, ' ')
  if (!normalized) return 'Design Preview'
  return normalized.length > 42 ? `${normalized.slice(0, 42)}...` : normalized
}

function slugFromPrompt(prompt: string): string {
  const ascii = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return ascii ? `${ascii.slice(0, 48).replace(/-+$/g, '')}-page` : 'generated-design-page'
}

function componentNameFromSlug(slug: string): string {
  const name = slug
    .split('-')
    .filter(Boolean)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('')
  return /^[A-Z]/.test(name) ? name : 'GeneratedDesignPage'
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderPreviewHtml(input: { title: string; prompt: string }): string {
  const title = escapeHtml(input.title)
  const prompt = escapeHtml(input.prompt)
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
    <style>
      :root {
        color-scheme: light;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #f8fafc;
        color: #111827;
      }
      body {
        margin: 0;
        min-height: 100vh;
        background: #f8fafc;
      }
      main {
        min-height: 100vh;
        display: grid;
        grid-template-rows: auto 1fr;
      }
      header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 24px;
        padding: 22px 48px;
        border-bottom: 1px solid #e5e7eb;
        background: #ffffff;
      }
      .brand {
        font-size: 14px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
      }
      nav {
        display: flex;
        gap: 18px;
        color: #6b7280;
        font-size: 13px;
      }
      section {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
        align-items: center;
        gap: 48px;
        padding: 64px 48px;
      }
      h1 {
        margin: 0;
        max-width: 720px;
        font-size: clamp(40px, 7vw, 76px);
        line-height: 0.95;
        letter-spacing: 0;
      }
      p {
        max-width: 620px;
        margin: 22px 0 0;
        color: #4b5563;
        font-size: 17px;
        line-height: 1.7;
      }
      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin-top: 30px;
      }
      .button {
        border: 1px solid #111827;
        border-radius: 6px;
        padding: 11px 16px;
        font-size: 14px;
        font-weight: 650;
        background: #111827;
        color: #ffffff;
      }
      .button.secondary {
        background: #ffffff;
        color: #111827;
      }
      .panel {
        border: 1px solid #e5e7eb;
        background: #ffffff;
        border-radius: 8px;
        padding: 18px;
        box-shadow: 0 20px 50px rgb(17 24 39 / 0.08);
      }
      .panel-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #f3f4f6;
        padding: 14px 0;
        font-size: 14px;
      }
      .panel-row:last-child {
        border-bottom: 0;
      }
      .metric {
        color: #059669;
        font-weight: 700;
      }
      @media (max-width: 820px) {
        header {
          padding: 18px 22px;
        }
        nav {
          display: none;
        }
        section {
          grid-template-columns: 1fr;
          padding: 38px 22px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div class="brand">Telegraph Design</div>
        <nav>
          <span>Overview</span>
          <span>Components</span>
          <span>Preview</span>
        </nav>
      </header>
      <section>
        <div>
          <h1>${title}</h1>
          <p>${prompt}</p>
          <div class="actions">
            <span class="button">Primary action</span>
            <span class="button secondary">View source</span>
          </div>
        </div>
        <aside class="panel" aria-label="Generated layout summary">
          <div class="panel-row"><span>Layout</span><span class="metric">Responsive</span></div>
          <div class="panel-row"><span>Artifact</span><span class="metric">Preview</span></div>
          <div class="panel-row"><span>Status</span><span class="metric">Generated</span></div>
        </aside>
      </section>
    </main>
  </body>
</html>`
}

function renderTsxSource(input: {
  componentName: string
  title: string
  prompt: string
}): string {
  return `import './styles.css'

const brief = {
  title: ${JSON.stringify(input.title)},
  prompt: ${JSON.stringify(input.prompt)},
}

const workflow = [
  { label: 'Brief', value: 'Captured' },
  { label: 'Structure', value: 'Responsive' },
  { label: 'Preview', value: 'Ready' },
]

export function ${input.componentName}() {
  return (
    <main className="app-shell">
      <nav className="topbar" aria-label="Primary">
        <span className="brand">Telegraph Design</span>
        <div className="nav-links" aria-hidden="true">
          <span>Overview</span>
          <span>Prototype</span>
          <span>Review</span>
        </div>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Standalone React app</p>
          <h1>{brief.title}</h1>
          <p className="lede">{brief.prompt}</p>
          <div className="actions">
            <button type="button">Launch preview</button>
            <button type="button" className="secondary">Inspect source</button>
          </div>
        </div>

        <aside className="status-panel" aria-label="Build status">
          <h2>Project output</h2>
          {workflow.map(item => (
            <div className="status-row" key={item.label}>
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </div>
          ))}
        </aside>
      </section>
    </main>
  )
}

export default ${input.componentName}
`
}

function renderEntrySource(): string {
  return `import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
`
}

function renderViteConfig(): string {
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`
}

function renderPackageJson(slug: string): string {
  return JSON.stringify({
    name: `telegraph-generated-${slug}`,
    version: '0.0.0',
    private: true,
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'tsc --noEmit && vite build',
      preview: 'vite preview',
    },
    dependencies: {
      react: '19.1.0',
      'react-dom': '19.1.0',
    },
    devDependencies: {
      '@types/react': '19.1.8',
      '@types/react-dom': '19.1.6',
      '@vitejs/plugin-react': 'latest',
      typescript: '5.3.3',
      vite: '^5.4.0',
    },
  }, null, 2)
}

function renderProjectIndexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <script src="${TAILWIND_PLAY_CDN_SCRIPT_URL}"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/index.tsx?entry"></script>
  </body>
</html>
`
}

function renderProjectStyles(): string {
  return `:root {
  color: #172033;
  background: #f5f7fb;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
}

button {
  min-height: 42px;
  border: 1px solid #172033;
  border-radius: 7px;
  padding: 0 16px;
  background: #172033;
  color: white;
  font: inherit;
  font-weight: 700;
}

button.secondary {
  background: white;
  color: #172033;
}

.app-shell {
  min-height: 100vh;
  background:
    linear-gradient(135deg, rgba(22, 163, 74, 0.13), transparent 34rem),
    linear-gradient(315deg, rgba(14, 165, 233, 0.14), transparent 30rem),
    #f5f7fb;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 48px;
  border-bottom: 1px solid rgba(23, 32, 51, 0.1);
  background: rgba(255, 255, 255, 0.78);
  backdrop-filter: blur(16px);
}

.brand {
  font-size: 14px;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.nav-links {
  display: flex;
  gap: 18px;
  color: #5b6475;
  font-size: 14px;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
  gap: 42px;
  align-items: center;
  width: min(1120px, calc(100% - 48px));
  min-height: calc(100vh - 74px);
  margin: 0 auto;
  padding: 54px 0;
}

.eyebrow {
  margin: 0 0 16px;
  color: #047857;
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

h1 {
  max-width: 760px;
  margin: 0;
  color: #101828;
  font-size: clamp(40px, 7vw, 76px);
  line-height: 0.96;
  letter-spacing: 0;
}

.lede {
  max-width: 680px;
  margin: 24px 0 0;
  color: #475467;
  font-size: 18px;
  line-height: 1.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.status-panel {
  border: 1px solid rgba(23, 32, 51, 0.12);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.86);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.12);
  padding: 22px;
}

.status-panel h2 {
  margin: 0 0 10px;
  font-size: 18px;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-top: 1px solid rgba(23, 32, 51, 0.08);
  padding: 15px 0;
  color: #5b6475;
}

.status-row strong {
  color: #047857;
}

@media (max-width: 820px) {
  .topbar {
    padding: 18px 22px;
  }

  .nav-links {
    display: none;
  }

  .hero {
    grid-template-columns: 1fr;
    width: min(100% - 36px, 640px);
    min-height: auto;
    padding: 42px 0;
  }
}
`
}

function isDesignPatchOperation(value: unknown): value is DesignPatchOperation {
  if (!isRecord(value)) return false
  if (value.kind !== 'add' && value.kind !== 'update' && value.kind !== 'delete') return false
  if (typeof value.path !== 'string' || value.path.length === 0) return false
  if ('content' in value && typeof value.content !== 'string') return false
  if ('expectedOriginal' in value && typeof value.expectedOriginal !== 'string') return false
  return true
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
