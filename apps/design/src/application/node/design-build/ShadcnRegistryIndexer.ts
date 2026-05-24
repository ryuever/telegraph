import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import {
  createRetrievalPolicySnapshot,
  type ComponentCandidate,
  type ComponentNeed,
  type ComponentRetrievalLedger,
  type ComponentRetrievalSource,
  type SelectedComponentAsset,
} from './ComponentRetrievalLedger'
import {
  RegistryTrustPolicy,
  retrievalMetrics,
} from './RegistryTrustPolicy'

const execFileAsync = promisify(execFile)

export interface ShadcnRegistryIndexerOptions {
  commandRunner?: ShadcnCliCommandRunner
  enableCli?: boolean
  timeoutMs?: number
  limit?: number
  trustPolicy?: RegistryTrustPolicy
}

export interface ShadcnRegistryRetrievalInput {
  prompt: string
  policy: DesignSystemPolicy
}

export interface ShadcnCliCommandRunner {
  run(args: string[]): Promise<ShadcnCliCommandResult>
}

export interface ShadcnCliCommandResult {
  stdout: string
  stderr?: string
}

export class ShadcnRegistryIndexer {
  private readonly commandRunner?: ShadcnCliCommandRunner
  private readonly enableCli: boolean
  private readonly limit: number
  private readonly trustPolicy: RegistryTrustPolicy

  constructor(options: ShadcnRegistryIndexerOptions = {}) {
    this.commandRunner = options.commandRunner ?? (options.enableCli ? new PnpmDlxShadcnCommandRunner(options.timeoutMs) : undefined)
    this.enableCli = Boolean(options.enableCli || options.commandRunner)
    this.limit = Math.max(1, options.limit ?? 8)
    this.trustPolicy = options.trustPolicy ?? new RegistryTrustPolicy()
  }

  async retrieve(input: ShadcnRegistryRetrievalInput): Promise<ComponentRetrievalLedger> {
    const pageType = inferPageType(input.prompt)
    const roles = inferComponentNeeds(pageType)
    const sources: ComponentRetrievalSource[] = []
    const cliCandidates = this.enableCli
      ? await this.retrieveCliCandidates(input.prompt, sources)
      : []

    if (!this.enableCli) {
      sources.push({
        kind: 'shadcn-cli-search',
        registry: '@shadcn',
        query: input.prompt,
        status: 'skipped',
        error: 'shadcn CLI retrieval is disabled; using deterministic official-catalog fallback.',
      })
    }

    const staticCandidates = staticCandidatesForPageType(pageType)
    sources.push({
      kind: 'static-shadcn-catalog',
      registry: '@shadcn',
      query: pageType,
      status: 'ok',
    })

    const mergedCandidates = mergeCandidates([...cliCandidates, ...staticCandidates])
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .slice(0, this.limit)
    const trust = this.trustPolicy.evaluate(mergedCandidates)
    const candidates = trust.allowed
    const selected = selectCandidates(candidates, roles)
    const selectedNames = new Set(selected.map(candidate => candidate.name))
    const fallbacks = selected.length === 0
      ? [{
          role: pageType,
          reason: this.enableCli ? 'not-found' as const : 'cli-unavailable' as const,
          searched: sources.map(source => source.query ?? source.registry),
          allowedScope: 'src/components/app/*',
        }]
      : []
    const rejected = [
      ...trust.rejected,
      ...candidates
        .filter(candidate => !selectedNames.has(candidate.name))
        .map(candidate => ({
          ...candidate,
          rejectionReason: 'Lower scoring than selected shadcn assets for this prompt.',
        })),
    ]

    return {
      query: {
        prompt: input.prompt,
        pageType,
        roles,
        selectedThemePack: input.policy.themePack?.id,
      },
      policy: createRetrievalPolicySnapshot(input.policy),
      trust: trust.metadata,
      retrieval: {
        status: sources.some(source => source.status === 'failed' || source.status === 'skipped') ? 'degraded' : 'complete',
        sources,
        degradedReason: sources.some(source => source.status === 'failed' || source.status === 'skipped')
          ? 'One or more live shadcn registry lookups were unavailable; selected assets come from the deterministic official-catalog fallback.'
          : undefined,
        metrics: retrievalMetrics({
          candidateCount: mergedCandidates.length,
          selectedCount: selected.length,
          rejectedCount: rejected.length,
          fallbackCount: fallbacks.length,
        }),
      },
      candidates,
      selected,
      fallbacks,
      rejected,
    }
  }

  private async retrieveCliCandidates(
    prompt: string,
    sources: ComponentRetrievalSource[],
  ): Promise<ComponentCandidate[]> {
    if (!this.commandRunner) return []

    const candidates: ComponentCandidate[] = []
    const search = await this.runCli(['search', '@shadcn', '-q', prompt, '-l', String(this.limit)], {
      kind: 'shadcn-cli-search',
      registry: '@shadcn',
      query: prompt,
    }, sources)
    if (search) candidates.push(...parseSearchOutput(search.stdout))

    for (const candidate of candidates.slice(0, 4)) {
      const docs = await this.runCli(['docs', candidate.name, '--json'], {
        kind: 'shadcn-cli-docs',
        registry: candidate.registry,
        query: candidate.name,
      }, sources)
      mergeCandidateMetadata(candidate, docs?.stdout)

      const view = await this.runCli(['view', candidate.name], {
        kind: 'shadcn-cli-view',
        registry: candidate.registry,
        query: candidate.name,
      }, sources)
      mergeCandidateMetadata(candidate, view?.stdout)
    }

    return candidates
  }

  private async runCli(
    args: string[],
    source: Omit<ComponentRetrievalSource, 'status' | 'error'>,
    sources: ComponentRetrievalSource[],
  ): Promise<ShadcnCliCommandResult | undefined> {
    try {
      const result = await this.commandRunner?.run(args)
      sources.push({ ...source, status: 'ok' })
      return result
    } catch (error) {
      sources.push({
        ...source,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
      return undefined
    }
  }
}

export class PnpmDlxShadcnCommandRunner implements ShadcnCliCommandRunner {
  constructor(private readonly timeoutMs = 4000) {}

  async run(args: string[]): Promise<ShadcnCliCommandResult> {
    const result = await execFileAsync('pnpm', ['dlx', 'shadcn@latest', ...args], {
      timeout: this.timeoutMs,
      maxBuffer: 1024 * 1024,
    })
    return {
      stdout: result.stdout,
      stderr: result.stderr,
    }
  }
}

function parseSearchOutput(stdout: string): ComponentCandidate[] {
  const parsed = parseJson(stdout)
  if (Array.isArray(parsed)) {
    return parsed.flatMap(value => candidateFromRecord(value, 10) ?? [])
  }
  if (isRecord(parsed) && Array.isArray(parsed.items)) {
    return parsed.items.flatMap(value => candidateFromRecord(value, 10) ?? [])
  }

  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .flatMap((line, index) => candidateFromSearchLine(line, Math.max(1, 10 - index)) ?? [])
}

function candidateFromRecord(value: unknown, score: number): ComponentCandidate | undefined {
  if (!isRecord(value)) return undefined
  const name = stringField(value, 'name') ?? stringField(value, 'id')
  if (!name) return undefined
  const type = registryType(stringField(value, 'type'))
  return {
    registry: stringField(value, 'registry') ?? '@shadcn',
    name,
    type,
    description: stringField(value, 'description'),
    score,
    reason: 'Returned by shadcn CLI registry search.',
    dependencies: stringArrayField(value, 'dependencies'),
    files: stringArrayField(value, 'files'),
  }
}

function candidateFromSearchLine(line: string, score: number): ComponentCandidate | undefined {
  const match = line.match(/(?:^|\s)(@[a-z0-9-]+\/)?([a-z][a-z0-9-]*)(?:\s|$)/i)
  const name = match?.[2]
  if (!name || ['copy', 'registry', 'items', 'name'].includes(name.toLowerCase())) return undefined
  const registry = match[1] ? match[1].replace(/\/$/, '') : '@shadcn'
  return {
    registry,
    name,
    type: name.includes('login') || name.includes('dashboard') || name.includes('sidebar') ? 'registry:block' : 'registry:ui',
    score,
    reason: 'Parsed from shadcn CLI search output.',
  }
}

function mergeCandidateMetadata(candidate: ComponentCandidate, stdout: string | undefined): void {
  if (!stdout) return
  const parsed = parseJson(stdout)
  if (!isRecord(parsed)) return
  candidate.description = candidate.description ?? stringField(parsed, 'description')
  const dependencies = stringArrayField(parsed, 'dependencies')
  const files = registryFiles(parsed)
  if (dependencies.length > 0) candidate.dependencies = unique([...(candidate.dependencies ?? []), ...dependencies])
  if (files.length > 0) candidate.files = unique([...(candidate.files ?? []), ...files])
}

function staticCandidatesForPageType(pageType: string): ComponentCandidate[] {
  const base = [
    staticCandidate('button', 'registry:ui', 8, 'Primary, secondary, and icon actions.', ['@radix-ui/react-slot', 'class-variance-authority'], ['src/components/ui/button.tsx']),
    staticCandidate('input', 'registry:ui', 7, 'Text fields for forms and filtering.', [], ['src/components/ui/input.tsx']),
    staticCandidate('card', 'registry:ui', 7, 'Grouped panels, forms, plans, and metrics.', [], ['src/components/ui/card.tsx']),
    staticCandidate('badge', 'registry:ui', 5, 'Status labels and compact metadata.', [], ['src/components/ui/badge.tsx']),
  ]
  const byPage: Record<string, ComponentCandidate[]> = {
    login: [
      staticCandidate('login-01', 'registry:block', 12, 'Official login block for authentication pages.', ['@radix-ui/react-label'], ['src/components/app/login-form.tsx']),
      ...base,
      staticCandidate('label', 'registry:ui', 6, 'Accessible form labels.', ['@radix-ui/react-label'], ['src/components/ui/label.tsx']),
    ],
    dashboard: [
      staticCandidate('dashboard-01', 'registry:block', 12, 'Official dashboard block for app shells and metrics.', [], ['src/components/app/dashboard-shell.tsx']),
      staticCandidate('sidebar', 'registry:block', 9, 'Sidebar block candidate for dashboard navigation.', [], ['src/components/app/sidebar.tsx']),
      staticCandidate('chart', 'registry:ui', 8, 'Chart primitive for dashboard visualization.', ['recharts'], ['src/components/ui/chart.tsx']),
      staticCandidate('table', 'registry:ui', 8, 'Data tables for operational records.', [], ['src/components/ui/table.tsx']),
      ...base,
    ],
    settings: [
      staticCandidate('tabs', 'registry:ui', 10, 'Tabbed settings panels.', ['@radix-ui/react-tabs'], ['src/components/ui/tabs.tsx']),
      staticCandidate('switch', 'registry:ui', 9, 'Binary settings toggles.', ['@radix-ui/react-switch'], ['src/components/ui/switch.tsx']),
      ...base,
    ],
    pricing: [
      staticCandidate('pricing-01', 'registry:block', 12, 'Pricing block candidate for plan comparison.', [], ['src/components/app/pricing-section.tsx']),
      ...base,
      staticCandidate('separator', 'registry:ui', 5, 'Separates pricing details.', ['@radix-ui/react-separator'], ['src/components/ui/separator.tsx']),
    ],
    landing: [
      staticCandidate('hero-01', 'registry:block', 11, 'Landing-page hero block candidate.', [], ['src/components/app/hero-section.tsx']),
      ...base,
      staticCandidate('accordion', 'registry:ui', 6, 'FAQ disclosure sections.', ['@radix-ui/react-accordion'], ['src/components/ui/accordion.tsx']),
    ],
    generic: base,
  }
  return byPage[pageType] ?? byPage.generic
}

function staticCandidate(
  name: string,
  type: ComponentCandidate['type'],
  score: number,
  description: string,
  dependencies: string[],
  files: string[],
): ComponentCandidate {
  return {
    registry: '@shadcn',
    name,
    type,
    description,
    score,
    reason: `Matched ${name} from the deterministic shadcn official catalog fixture.`,
    dependencies,
    files,
  }
}

function selectCandidates(candidates: ComponentCandidate[], roles: ComponentNeed[]): SelectedComponentAsset[] {
  const roleNames = new Set(roles.flatMap(role => [role.role, ...role.examples]).map(value => value.toLowerCase()))
  const selected = candidates.filter(candidate =>
    roleNames.has(candidate.name.toLowerCase()) ||
    roleNames.has(candidate.name.replace(/-\d+$/, '').toLowerCase()) ||
    candidate.score >= 8
  )
  return selected.slice(0, 8).map(candidate => ({
    ...candidate,
    materializedFiles: candidate.files ?? [],
    importExamples: importExamplesForCandidate(candidate),
  }))
}

function importExamplesForCandidate(candidate: ComponentCandidate): string[] {
  if (candidate.type === 'registry:block') return []
  const exportName = candidate.name.split('-').map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`).join('')
  return [`import { ${exportName} } from "@/components/ui/${candidate.name}"`]
}

function inferPageType(prompt: string): string {
  const terms = prompt.toLowerCase()
  if (/(login|sign in|signin|auth|登录)/.test(terms)) return 'login'
  if (/(dashboard|admin|analytics|仪表盘)/.test(terms)) return 'dashboard'
  if (/(settings|preferences|配置|设置)/.test(terms)) return 'settings'
  if (/(pricing|plans|billing|价格|套餐)/.test(terms)) return 'pricing'
  if (/(landing|marketing|homepage|hero|官网|首页)/.test(terms)) return 'landing'
  return 'generic'
}

function inferComponentNeeds(pageType: string): ComponentNeed[] {
  const needs: Record<string, ComponentNeed[]> = {
    login: [
      need('login', true, ['login-01']),
      need('button', true, ['button']),
      need('input', true, ['input']),
      need('card', true, ['card']),
    ],
    dashboard: [
      need('card', true, ['card']),
      need('table', true, ['table']),
      need('badge', true, ['badge']),
      need('chart', false, ['chart']),
      need('sidebar', false, ['sidebar']),
    ],
    settings: [
      need('tabs', true, ['tabs']),
      need('switch', true, ['switch']),
      need('input', true, ['input']),
      need('button', true, ['button']),
    ],
    pricing: [
      need('pricing', true, ['pricing-01']),
      need('card', true, ['card']),
      need('badge', true, ['badge']),
      need('button', true, ['button']),
    ],
    landing: [
      need('hero', true, ['hero-01']),
      need('button', true, ['button']),
      need('card', false, ['card']),
      need('accordion', false, ['accordion']),
    ],
    generic: [
      need('button', true, ['button']),
      need('card', true, ['card']),
    ],
  }
  return needs[pageType] ?? needs.generic
}

function need(role: string, required: boolean, examples: string[]): ComponentNeed {
  return { role, required, examples }
}

function mergeCandidates(candidates: ComponentCandidate[]): ComponentCandidate[] {
  const merged = new Map<string, ComponentCandidate>()
  for (const candidate of candidates) {
    const key = `${candidate.registry}:${candidate.name}`
    const existing = merged.get(key)
    if (!existing || candidate.score > existing.score) {
      merged.set(key, {
        ...existing,
        ...candidate,
        dependencies: unique([...(existing?.dependencies ?? []), ...(candidate.dependencies ?? [])]),
        files: unique([...(existing?.files ?? []), ...(candidate.files ?? [])]),
      })
    }
  }
  return [...merged.values()]
}

function registryFiles(value: Record<string, unknown>): string[] {
  const files = value.files
  if (!Array.isArray(files)) return []
  return files.flatMap(file => {
    if (typeof file === 'string') return [file]
    if (isRecord(file)) return stringField(file, 'path') ?? []
    return []
  })
}

function registryType(value: string | undefined): ComponentCandidate['type'] {
  return value === 'registry:block' || value === 'registry:component' || value === 'registry:ui'
    ? value
    : 'registry:ui'
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field.trim().length > 0 ? field : undefined
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const field = value[key]
  return Array.isArray(field) ? field.filter((item): item is string => typeof item === 'string') : []
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
