import { readdir } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'

export interface ComponentAsset {
  id: string
  name: string
  importPath: string
  category: 'layout' | 'form' | 'display' | 'navigation' | 'data' | 'feedback' | 'utility'
  usageHint: string
  sourcePath?: string
  keywords: string[]
}

export interface ComponentSearchResult extends ComponentAsset {
  score: number
  reason: string
}

export interface ComponentSearchOptions {
  limit?: number
}

const DEFAULT_LIMIT = 6

const STATIC_COMPONENTS: ComponentAsset[] = [
  asset('button', 'Button', 'form', 'Use for primary, secondary, and icon actions.', ['action', 'cta', 'submit', 'confirm']),
  asset('input', 'Input', 'form', 'Use for short text fields such as email, search, names, and filters.', ['field', 'email', 'search', 'login', 'form']),
  asset('textarea', 'Textarea', 'form', 'Use for long-form prompts, comments, descriptions, and messages.', ['prompt', 'message', 'comment', 'form']),
  asset('card', 'Card', 'layout', 'Use to group related content, metrics, plans, or dashboard panels.', ['panel', 'dashboard', 'pricing', 'metric', 'section']),
  asset('tabs', 'Tabs', 'navigation', 'Use to switch between related views without leaving the page.', ['settings', 'view', 'navigation', 'segmented']),
  asset('badge', 'Badge', 'display', 'Use for status labels, small metadata, and plan tags.', ['status', 'label', 'tag', 'plan']),
  asset('table', 'Table', 'data', 'Use for tabular records, admin pages, and comparison data.', ['data', 'records', 'dashboard', 'admin']),
  {
    id: 'toolbar',
    name: 'Toolbar',
    importPath: '@/packages/ui/components/Toolbar',
    category: 'utility',
    usageHint: 'Use for compact command rows and tool surfaces.',
    sourcePath: 'packages/ui/src/components/Toolbar.tsx',
    keywords: ['tools', 'commands', 'editor', 'actions'],
  },
]

const QUERY_SYNONYMS: Record<string, string[]> = {
  login: ['input', 'button', 'card', 'form', 'email'],
  signin: ['input', 'button', 'card', 'form', 'email'],
  signup: ['input', 'button', 'card', 'form'],
  dashboard: ['card', 'table', 'badge', 'tabs', 'metric'],
  admin: ['table', 'tabs', 'badge', 'dashboard'],
  settings: ['tabs', 'input', 'button', 'form'],
  pricing: ['card', 'badge', 'button', 'plan'],
  chat: ['textarea', 'button', 'message'],
  editor: ['toolbar', 'textarea', 'button'],
}

export class ComponentAssetRegistry {
  private readonly assets = new Map<string, ComponentAsset>()

  constructor(initialAssets: ComponentAsset[] = STATIC_COMPONENTS) {
    for (const component of initialAssets) {
      this.register(component)
    }
  }

  register(component: ComponentAsset): void {
    this.assets.set(component.id, component)
  }

  list(): ComponentAsset[] {
    return [...this.assets.values()].map(component => ({ ...component, keywords: [...component.keywords] }))
  }

  async scanWorkspace(workspaceRoot = process.cwd()): Promise<ComponentAsset[]> {
    const uiDir = resolve(workspaceRoot, 'packages/ui/src/components/ui')
    const entries = await readdir(uiDir, { withFileTypes: true }).catch(() => [])
    const discovered: ComponentAsset[] = []

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.tsx')) continue
      const id = basename(entry.name, '.tsx')
      const sourcePath = relative(workspaceRoot, join(uiDir, entry.name))
      const existing = this.assets.get(id)
      const component = existing ?? inferComponentAsset(id, sourcePath)
      this.register({
        ...component,
        sourcePath,
      })
      discovered.push(this.assets.get(id) ?? component)
    }

    return discovered.map(component => ({ ...component, keywords: [...component.keywords] }))
  }

  searchComponents(query: string, options: ComponentSearchOptions = {}): ComponentSearchResult[] {
    const terms = expandedTerms(query)
    const limit = Math.max(1, options.limit ?? DEFAULT_LIMIT)
    const results = this.list()
      .map(component => scoreComponent(component, terms))
      .filter(result => result.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))

    if (results.length > 0) return results.slice(0, limit)

    return this.list()
      .slice(0, limit)
      .map(component => ({
        ...component,
        score: 1,
        reason: 'Default design component available in the shared UI catalog.',
      }))
  }
}

export function createDefaultComponentAssetRegistry(): ComponentAssetRegistry {
  return new ComponentAssetRegistry()
}

function asset(
  id: string,
  name: string,
  category: ComponentAsset['category'],
  usageHint: string,
  keywords: string[],
): ComponentAsset {
  return {
    id,
    name,
    importPath: `@/packages/ui/components/ui/${id}`,
    category,
    usageHint,
    sourcePath: `packages/ui/src/components/ui/${id}.tsx`,
    keywords: [id, name.toLowerCase(), category, ...keywords],
  }
}

function inferComponentAsset(id: string, sourcePath: string): ComponentAsset {
  return {
    id,
    name: toTitle(id),
    importPath: `@/packages/ui/components/ui/${id}`,
    category: inferCategory(id),
    usageHint: `Use ${toTitle(id)} where the generated page needs a ${id} UI primitive.`,
    sourcePath,
    keywords: [id, toTitle(id).toLowerCase(), inferCategory(id)],
  }
}

function inferCategory(id: string): ComponentAsset['category'] {
  if (['input', 'textarea', 'select', 'checkbox', 'switch', 'button'].includes(id)) return 'form'
  if (['tabs', 'breadcrumb', 'menu', 'navigation'].includes(id)) return 'navigation'
  if (['table', 'chart'].includes(id)) return 'data'
  if (['badge', 'avatar'].includes(id)) return 'display'
  if (['alert', 'toast'].includes(id)) return 'feedback'
  return 'layout'
}

function scoreComponent(component: ComponentAsset, terms: Set<string>): ComponentSearchResult {
  const haystack = [
    component.id,
    component.name,
    component.category,
    component.usageHint,
    component.importPath,
    component.sourcePath ?? '',
    ...component.keywords,
  ].join(' ').toLowerCase()

  let score = 0
  const matched: string[] = []
  for (const term of terms) {
    if (!term) continue
    if (component.id === term) score += 6
    if (component.name.toLowerCase() === term) score += 5
    if (component.category === term) score += 3
    if (component.keywords.includes(term)) score += 3
    if (haystack.includes(term)) score += 1
    if (haystack.includes(term)) matched.push(term)
  }

  return {
    ...component,
    score,
    reason: matched.length > 0
      ? `Matched ${[...new Set(matched)].join(', ')} in the component catalog.`
      : '',
  }
}

function expandedTerms(query: string): Set<string> {
  const terms = new Set(tokenize(query))
  for (const term of [...terms]) {
    for (const synonym of QUERY_SYNONYMS[term] ?? []) {
      terms.add(synonym)
    }
  }
  return terms
}

function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
    .map(term => term.trim())
    .filter(Boolean)
}

function toTitle(id: string): string {
  return id
    .split(/[-_]+/)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}
