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

export function createMockDesignPreviewArtifact(input: {
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

export function createMockDesignPatchArtifact(input: {
  runId: string
  prompt: string
  parentArtifactId?: string
  revision?: number
  changeSummary?: string
}): DesignPatchArtifact {
  const title = titleFromPrompt(input.prompt)
  const slug = slugFromPrompt(input.prompt)
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
        path: `apps/design/src/generated/${slug}.tsx`,
        content: renderTsxSource({
          componentName: componentNameFromSlug(slug),
          title,
          prompt: input.prompt,
        }),
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

function escapeJsString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$')
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
          <div class="panel-row"><span>Status</span><span class="metric">Mock MVP</span></div>
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
  const title = escapeJsString(input.title)
  const prompt = escapeJsString(input.prompt)
  const archetype = pageArchetypeFromPrompt(input.prompt)
  return `${importsForArchetype(archetype)}

${dataForArchetype(archetype)}

export function ${input.componentName}() {
  return (
${bodyForArchetype(archetype, { title, prompt })}
  )
}

export default ${input.componentName}
`
}

type PageArchetype = 'dashboard' | 'login' | 'pricing' | 'settings' | 'landing'

function pageArchetypeFromPrompt(prompt: string): PageArchetype {
  const normalized = prompt.toLowerCase()
  if (/\b(login|sign in|signin|auth|authentication)\b/.test(normalized)) return 'login'
  if (/\b(pricing|price|plan|subscription|billing)\b/.test(normalized)) return 'pricing'
  if (/\b(settings|setting|preferences|profile)\b/.test(normalized)) return 'settings'
  if (/\b(dashboard|analytics|admin|metrics|overview)\b/.test(normalized)) return 'dashboard'
  return 'landing'
}

function importsForArchetype(archetype: PageArchetype): string {
  const imports = [`import { Badge } from '@/packages/ui/components/ui/badge'`,
    `import { Button } from '@/packages/ui/components/ui/button'`,
    `import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/packages/ui/components/ui/card'`]
  if (archetype === 'login') {
    imports.push(`import { Input } from '@/packages/ui/components/ui/input'`)
  }
  if (archetype === 'settings') {
    imports.push(`import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/packages/ui/components/ui/tabs'`)
  }
  return imports.join('\n')
}

function dataForArchetype(archetype: PageArchetype): string {
  if (archetype === 'dashboard') {
    return `const metrics = [
  { label: 'Revenue', value: '$128.4K', delta: '+12.6%' },
  { label: 'Activation', value: '68%', delta: '+4.1%' },
  { label: 'Pipeline', value: '342', delta: '+28' },
]

const activity = ['Enterprise lead qualified', 'Checkout conversion improved', 'North-star metric updated']`
  }
  if (archetype === 'login') {
    return `const trustSignals = ['SSO ready', 'Workspace aware', 'Secure session']`
  }
  if (archetype === 'pricing') {
    return `const plans = [
  { name: 'Starter', price: '$19', summary: 'For validating the first workflow' },
  { name: 'Growth', price: '$79', summary: 'For teams shipping every week' },
  { name: 'Scale', price: 'Custom', summary: 'For governed product organizations' },
]`
  }
  if (archetype === 'settings') {
    return `const settingsRows = [
  ['Workspace name', 'Telegraph Design'],
  ['Default runtime', 'Design Build'],
  ['Artifact policy', 'Preview before apply'],
]`
  }
  return `const highlights = [
  'Structured brief',
  'Component-aware layout',
  'Patch-first source output',
]`
}

function bodyForArchetype(
  archetype: PageArchetype,
  input: { title: string; prompt: string },
): string {
  if (archetype === 'dashboard') return dashboardBody(input)
  if (archetype === 'login') return loginBody(input)
  if (archetype === 'pricing') return pricingBody(input)
  if (archetype === 'settings') return settingsBody(input)
  return landingBody(input)
}

function dashboardBody(input: { title: string; prompt: string }): string {
  return `    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <section className="mx-auto flex max-w-6xl flex-col gap-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Badge variant="secondary">Generated dashboard</Badge>
            <h1 className="mt-4 text-4xl font-semibold tracking-normal">{\`${input.title}\`}</h1>
            <p className="mt-3 max-w-2xl text-base leading-7 text-muted-foreground">{\`${input.prompt}\`}</p>
          </div>
          <Button>Export report</Button>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {metrics.map(metric => (
            <Card key={metric.label}>
              <CardHeader>
                <CardDescription>{metric.label}</CardDescription>
                <CardTitle>{metric.value}</CardTitle>
              </CardHeader>
              <CardContent>
                <Badge variant="outline">{metric.delta}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Latest activity</CardTitle>
            <CardDescription>Operational signals for the generated workflow</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {activity.map(item => (
              <div key={item} className="rounded-md border border-border px-3 py-2 text-sm">{item}</div>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>`
}

function loginBody(input: { title: string; prompt: string }): string {
  return `    <main className="grid min-h-screen bg-background px-6 py-8 text-foreground lg:grid-cols-[1fr_420px]">
      <section className="flex items-center">
        <div className="max-w-2xl">
          <Badge variant="secondary">Secure access</Badge>
          <h1 className="mt-5 text-5xl font-semibold leading-none tracking-normal">{\`${input.title}\`}</h1>
          <p className="mt-5 text-base leading-7 text-muted-foreground">{\`${input.prompt}\`}</p>
          <div className="mt-7 flex flex-wrap gap-2">
            {trustSignals.map(item => <Badge key={item} variant="outline">{item}</Badge>)}
          </div>
        </div>
      </section>

      <Card className="self-center">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Continue to your workspace</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input placeholder="email@company.com" />
          <Input placeholder="Password" type="password" />
          <Button className="w-full">Continue</Button>
        </CardContent>
      </Card>
    </main>`
}

function pricingBody(input: { title: string; prompt: string }): string {
  return `    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <section className="mx-auto max-w-6xl">
        <Badge variant="secondary">Pricing</Badge>
        <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-none tracking-normal">{\`${input.title}\`}</h1>
        <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">{\`${input.prompt}\`}</p>

        <div className="mt-8 grid gap-4 md:grid-cols-3">
          {plans.map(plan => (
            <Card key={plan.name}>
              <CardHeader>
                <CardTitle>{plan.name}</CardTitle>
                <CardDescription>{plan.summary}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-semibold">{plan.price}</div>
                <Button className="mt-5 w-full" variant={plan.name === 'Growth' ? 'default' : 'outline'}>
                  Choose {plan.name}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </main>`
}

function settingsBody(input: { title: string; prompt: string }): string {
  return `    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <section className="mx-auto max-w-5xl">
        <Badge variant="secondary">Settings</Badge>
        <h1 className="mt-5 text-4xl font-semibold tracking-normal">{\`${input.title}\`}</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{\`${input.prompt}\`}</p>

        <Tabs defaultValue="workspace" className="mt-8">
          <TabsList>
            <TabsTrigger value="workspace">Workspace</TabsTrigger>
            <TabsTrigger value="runtime">Runtime</TabsTrigger>
          </TabsList>
          <TabsContent value="workspace">
            <Card>
              <CardHeader>
                <CardTitle>Workspace preferences</CardTitle>
                <CardDescription>Generated settings scaffold</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {settingsRows.map(([label, value]) => (
                  <div key={label} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                    <span>{label}</span>
                    <Badge variant="outline">{value}</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="runtime">
            <Card>
              <CardHeader>
                <CardTitle>Runtime policy</CardTitle>
                <CardDescription>Patch-first generation with review before apply</CardDescription>
              </CardHeader>
              <CardContent>
                <Button>Save preferences</Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </section>
    </main>`
}

function landingBody(input: { title: string; prompt: string }): string {
  return `    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <section className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <Badge variant="secondary">Generated by Telegraph Design</Badge>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold leading-none tracking-normal">
            {\`${input.title}\`}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">
            {\`${input.prompt}\`}
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Button>Primary action</Button>
            <Button variant="outline">Review source</Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Build summary</CardTitle>
            <CardDescription>Initial design-build patch artifact</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {highlights.map(item => (
              <div
                key={item}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm"
              >
                <span>{item}</span>
                <Badge variant="outline">ready</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>`
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
