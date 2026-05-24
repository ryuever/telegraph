import https from 'node:https'
import type {
  UiComponentCatalogEntry,
  UiComponentInstallFile,
  UiComponentInstallPlan,
  UiComponentLibraryProvider,
  UiComponentUsage,
} from './UiComponentLibraryProvider'
import shadcnComponentsLlms from './shadcn-components.llms.json'

export interface ShadcnFetchResponse {
  ok: boolean
  status: number
  url?: string
  text(): Promise<string>
}

export type ShadcnFetchFn = (url: string) => Promise<ShadcnFetchResponse>

export interface ShadcnUiLibraryProviderOptions {
  fetchFn?: ShadcnFetchFn
  maxMarkdownChars?: number
  llmsUrl?: string
  registryBaseUrl?: string
}

const SHADCN_LIBRARY_ID = 'shadcn'
const SHADCN_LLMS_URL = 'https://ui.shadcn.com/llms.txt'
const SHADCN_COMPONENT_DOCS_URL = 'https://ui.shadcn.com/docs/components'
const SHADCN_DEFAULT_REGISTRY_BASE_URL = 'https://ui.shadcn.com/r/styles/default'
const DEFAULT_MAX_MARKDOWN_CHARS = 80_000
const LOCAL_SHADCN_COMPONENT_CATALOG = shadcnComponentsLlms as UiComponentCatalogEntry[]

export class ShadcnUiLibraryProvider implements UiComponentLibraryProvider {
  readonly library = SHADCN_LIBRARY_ID

  private readonly fetchFn: ShadcnFetchFn
  private readonly maxMarkdownChars: number
  private readonly llmsUrl: string
  private readonly registryBaseUrl: string
  private catalogPromise?: Promise<UiComponentCatalogEntry[]>

  constructor(options: ShadcnUiLibraryProviderOptions = {}) {
    this.fetchFn = options.fetchFn ?? nodeHttpsFetch
    this.maxMarkdownChars = options.maxMarkdownChars ?? DEFAULT_MAX_MARKDOWN_CHARS
    this.llmsUrl = options.llmsUrl ?? SHADCN_LLMS_URL
    this.registryBaseUrl = options.registryBaseUrl ?? SHADCN_DEFAULT_REGISTRY_BASE_URL
  }

  async listComponents(): Promise<UiComponentCatalogEntry[]> {
    this.catalogPromise ??= this.fetchCatalog()
    return this.catalogPromise
  }

  async getComponentUsages(componentNames: string[]): Promise<UiComponentUsage[]> {
    const catalog = await this.listComponents()
    const byName = new Map(catalog.map(component => [component.name, component]))
    const names = unique(componentNames.map(name => resolveComponentName(name, catalog)).filter(Boolean))

    return Promise.all(names.map(async name => {
      const catalogEntry = byName.get(name)
      if (!catalogEntry) {
        return unavailableUsage(name, `Component "${name}" was not found in the shadcn llms.txt component catalog.`)
      }

      try {
        const response = await this.fetchFn(catalogEntry.usageUrl)
        if (!response.ok) {
          return unavailableUsage(name, `Failed to fetch shadcn usage markdown: HTTP ${response.status}.`, catalogEntry)
        }
        const rawContent = await response.text()
        const markdownContent = rawContent.slice(0, this.maxMarkdownChars)
        return {
          library: this.library,
          name,
          title: catalogEntry.title,
          sourceUrl: response.url || catalogEntry.usageUrl,
          contentType: 'text/markdown',
          markdownContent,
          truncated: rawContent.length > markdownContent.length,
          available: true,
        }
      } catch (error) {
        return unavailableUsage(name, error instanceof Error ? error.message : String(error), catalogEntry)
      }
    }))
  }

  normalizeComponentName(componentName: string): string {
    return normalizeName(componentName)
  }

  async installComponent(componentName: string): Promise<UiComponentInstallPlan> {
    const catalog = await this.listComponents()
    const rootName = resolveComponentName(componentName, catalog)
    const installedComponentNames: string[] = []
    const registryDependencies = new Set<string>()
    const dependencies = new Set<string>()
    const files: UiComponentInstallFile[] = []
    const visited = new Set<string>()

    await this.collectInstallItem(rootName, {
      visited,
      installedComponentNames,
      registryDependencies,
      dependencies,
      files,
    })

    return {
      library: this.library,
      name: rootName,
      sourceUrl: registryItemUrl(this.registryBaseUrl, rootName),
      dependencies: [...dependencies],
      registryDependencies: [...registryDependencies],
      installedComponentNames,
      files,
    }
  }

  private async fetchCatalog(): Promise<UiComponentCatalogEntry[]> {
    if (LOCAL_SHADCN_COMPONENT_CATALOG.length > 0) {
      return LOCAL_SHADCN_COMPONENT_CATALOG
    }

    try {
      const response = await this.fetchFn(this.llmsUrl)
      if (!response.ok) return []
      const parsed = parseShadcnLlmsComponents(await response.text())
      return parsed
    } catch {
      return []
    }
  }

  private async collectInstallItem(
    componentName: string,
    collector: {
      visited: Set<string>
      installedComponentNames: string[]
      registryDependencies: Set<string>
      dependencies: Set<string>
      files: UiComponentInstallFile[]
    },
  ): Promise<void> {
    const normalizedName = normalizeName(componentName)
    if (collector.visited.has(normalizedName)) return
    collector.visited.add(normalizedName)

    const item = await this.fetchRegistryItem(normalizedName)
    collector.installedComponentNames.push(normalizedName)
    for (const dependency of item.dependencies) {
      collector.dependencies.add(dependency)
    }
    for (const dependency of item.registryDependencies) {
      const dependencyName = normalizeName(dependency)
      collector.registryDependencies.add(dependencyName)
      await this.collectInstallItem(dependencyName, collector)
    }
    collector.files.push(...item.files)
  }

  private async fetchRegistryItem(componentName: string): Promise<ParsedRegistryItem> {
    const url = registryItemUrl(this.registryBaseUrl, componentName)
    const response = await this.fetchFn(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch shadcn registry item "${componentName}": HTTP ${response.status}.`)
    }
    const parsed = parseJsonRecord(await response.text())
    if (!parsed) {
      throw new Error(`Failed to parse shadcn registry item "${componentName}".`)
    }
    return {
      dependencies: stringArrayField(parsed, 'dependencies'),
      registryDependencies: stringArrayField(parsed, 'registryDependencies'),
      files: registryFiles(parsed),
    }
  }
}

function nodeHttpsFetch(url: string, redirectCount = 0): Promise<ShadcnFetchResponse> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: {
        'user-agent': 'telegraph-design-build',
      },
    }, response => {
      const status = response.statusCode ?? 0
      const location = response.headers.location
      if (status >= 300 && status < 400 && location && redirectCount < 5) {
        response.resume()
        const redirectUrl = new URL(location, url).toString()
        resolve(nodeHttpsFetch(redirectUrl, redirectCount + 1))
        return
      }

      const chunks: Buffer[] = []
      response.on('data', chunk => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)))
      })
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        resolve({
          ok: status >= 200 && status < 300,
          status,
          url,
          text: () => Promise.resolve(body),
        })
      })
    })
    request.on('error', reject)
    request.setTimeout(8_000, () => {
      request.destroy(new Error(`Timed out fetching ${url}.`))
    })
  })
}

export function parseShadcnLlmsComponents(markdown: string): UiComponentCatalogEntry[] {
  const components: UiComponentCatalogEntry[] = []
  let insideComponents = false
  let category = 'Components'

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('## ')) {
      insideComponents = line === '## Components'
      continue
    }
    if (!insideComponents) continue
    if (line.startsWith('### ')) {
      category = line.slice(4).trim()
      continue
    }

    const match = line.match(/^- \[([^\]]+)\]\((https:\/\/ui\.shadcn\.com\/docs\/components\/[^)]+)\):\s*(.+)$/)
    if (!match) continue
    const [, title, docsUrl, description] = match
    const name = nameFromDocsUrl(docsUrl)
    components.push({
      library: SHADCN_LIBRARY_ID,
      name,
      title,
      category,
      description,
      docsUrl,
      usageUrl: `${docsUrl}.md`,
      aliases: aliasesForComponent(name, title),
    })
  }

  return components
}

function unavailableUsage(
  name: string,
  error: string,
  catalogEntry?: UiComponentCatalogEntry,
): UiComponentUsage {
  return {
    library: SHADCN_LIBRARY_ID,
    name,
    title: catalogEntry?.title ?? name,
    sourceUrl: catalogEntry?.usageUrl ?? `${SHADCN_COMPONENT_DOCS_URL}/${name}.md`,
    contentType: 'text/markdown',
    markdownContent: '',
    truncated: false,
    available: false,
    error,
  }
}

interface ParsedRegistryItem {
  dependencies: string[]
  registryDependencies: string[]
  files: UiComponentInstallFile[]
}

function registryItemUrl(registryBaseUrl: string, componentName: string): string {
  return `${registryBaseUrl.replace(/\/$/, '')}/${componentName}.json`
}

function registryFiles(value: Record<string, unknown>): UiComponentInstallFile[] {
  const files = value.files
  if (!Array.isArray(files)) return []
  return files.flatMap(file => {
    if (!isRecord(file)) return []
    const path = stringField(file, 'path')
    const content = stringField(file, 'content')
    if (!path || content === undefined) return []
    return [{
      path,
      content: normalizeRegistryFileContent(content),
      type: stringField(file, 'type'),
    }]
  })
}

function normalizeRegistryFileContent(content: string): string {
  return content
    .replace(/@\/registry\/[^/]+\/ui/g, '@/components/ui')
    .replace(/@\/registry\/[^/]+\/hooks/g, '@/hooks')
    .replace(/@\/registry\/[^/]+\/lib/g, '@/lib')
    .replace(/@\/registry\/[^/]+\/components/g, '@/components')
}

function parseJsonRecord(content: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(content) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const field = value[key]
  return Array.isArray(field) ? field.filter((item): item is string => typeof item === 'string') : []
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' ? field : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nameFromDocsUrl(docsUrl: string): string {
  return normalizeName(docsUrl.split('/').at(-1) ?? '')
}

function normalizeName(value: string): string {
  return value
    .trim()
    .replace(/\.(tsx|jsx|ts|js|md)$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function aliasesForComponent(name: string, title: string): string[] {
  return unique([
    name,
    name.replace(/-/g, ''),
    normalizeName(title),
    normalizeName(title).replace(/-/g, ''),
  ]).filter(alias => alias !== name)
}

function resolveComponentName(value: string, catalog: UiComponentCatalogEntry[]): string {
  const normalized = normalizeName(value)
  const compact = normalized.replace(/-/g, '')
  const exact = catalog.find(component =>
    component.name === normalized ||
    component.name.replace(/-/g, '') === compact ||
    component.aliases.includes(normalized) ||
    component.aliases.includes(compact)
  )
  if (exact) return exact.name

  return normalized
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
