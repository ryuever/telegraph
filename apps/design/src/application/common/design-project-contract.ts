export interface DesignProjectFileOperation {
  path: string
  kind: 'add' | 'update' | 'delete'
  content?: string
}

export interface StandaloneProjectContractCheck {
  id: string
  passed: boolean
  summary: string
}

export interface StandaloneProjectContractResult {
  projectRoot?: string
  checks: StandaloneProjectContractCheck[]
  passed: boolean
}

const REACT_ENTRY_FILES = ['src/index.tsx', 'src/main.tsx', 'src/index.jsx', 'src/main.jsx']
const SOURCE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.css', '.json', '.svg']
const INDEX_SOURCE_FILES = SOURCE_EXTENSIONS.map(extension => `index${extension}`)
const FORBIDDEN_WORKSPACE_IMPORT_PATTERNS = [
  /from\s+['"]@\/packages\//,
  /from\s+['"]@\/apps\//,
  /from\s+['"]@telegraph\//,
  /import\s*\(\s*['"]@\/packages\//,
  /import\s*\(\s*['"]@\/apps\//,
  /import\s*\(\s*['"]@telegraph\//,
]

export function evaluateStandaloneProjectFiles(
  operations: DesignProjectFileOperation[],
): StandaloneProjectContractResult {
  const projectRoot = inferSandboxProjectRoot(operations)
  const packageOperation = findProjectFileOperation(operations, ['package.json'], projectRoot)
  const packageJson = packageJsonStatus(packageOperation?.content)
  const hasIndexHtml = Boolean(findProjectFileOperation(operations, ['index.html'], projectRoot))
  const hasReactEntry = Boolean(findProjectFileOperation(operations, REACT_ENTRY_FILES, projectRoot))
  const hasAppSource = hasRenderableSourceFile(operations, projectRoot)
  const hasStandaloneImports = operations.every(operation =>
    operation.kind === 'delete' ||
    !operation.content ||
    !FORBIDDEN_WORKSPACE_IMPORT_PATTERNS.some(pattern => pattern.test(operation.content ?? ''))
  )
  const missingLocalImports = findMissingLocalImports(operations, projectRoot)

  const checks: StandaloneProjectContractCheck[] = [
    {
      id: 'standalone-package-root',
      passed: Boolean(projectRoot && packageOperation),
      summary: 'Project includes package.json under a generated project root.',
    },
    {
      id: 'standalone-package-json',
      passed: packageJson.valid,
      summary: packageJson.summary,
    },
    {
      id: 'standalone-index-html',
      passed: hasIndexHtml,
      summary: 'Project includes index.html with the browser mount point.',
    },
    {
      id: 'standalone-react-entry',
      passed: hasReactEntry,
      summary: 'Project includes src/index.tsx, src/main.tsx, or an equivalent React entry file.',
    },
    {
      id: 'standalone-app-source',
      passed: hasAppSource,
      summary: 'Project includes renderable React source beyond the browser entry.',
    },
    {
      id: 'standalone-local-imports',
      passed: missingLocalImports.length === 0,
      summary: missingLocalImports.length === 0
        ? 'Local relative imports resolve to generated project files.'
        : `Missing generated files for local imports: ${missingLocalImports.slice(0, 5).join(', ')}`,
    },
    {
      id: 'standalone-imports',
      passed: hasStandaloneImports,
      summary: 'Project source does not import Telegraph workspace-only modules.',
    },
  ]

  return {
    projectRoot,
    checks,
    passed: checks.every(check => check.passed),
  }
}

export function inferSandboxProjectRoot(operations: DesignProjectFileOperation[]): string | undefined {
  const packageOperation = operations.find(operation =>
    operation.kind !== 'delete' && operation.content && normalizedPathSegments(operation.path).at(-1) === 'package.json'
  )
  if (!packageOperation) return undefined

  const segments = normalizedPathSegments(packageOperation.path)
  if (segments.length <= 1) return undefined
  return segments.slice(0, -1).join('/')
}

export function sandboxVirtualPathForOperation(path: string, projectRoot: string | undefined): string {
  const normalized = normalizeOperationPath(path)
  const relative = projectRoot && (normalized === projectRoot || normalized.startsWith(`${projectRoot}/`))
    ? normalized.slice(projectRoot.length).replace(/^\/+/, '')
    : normalized
  return `/${relative}`
}

export function isSafeProjectPatchPath(path: string): boolean {
  const trimmed = path.trim()
  if (!trimmed || trimmed.startsWith('/') || /^[a-z]:/i.test(trimmed)) return false
  return !normalizedPathSegments(trimmed).includes('..')
}

function findProjectFileOperation(
  operations: DesignProjectFileOperation[],
  relativePaths: string[],
  projectRoot: string | undefined,
): DesignProjectFileOperation | undefined {
  const candidates = new Set(relativePaths)
  return operations.find(operation => {
    if (operation.kind === 'delete' || !operation.content) return false
    return candidates.has(projectRelativePath(operation.path, projectRoot))
  })
}

function projectRelativePath(path: string, projectRoot: string | undefined): string {
  const normalized = normalizeOperationPath(path)
  if (projectRoot && normalized.startsWith(`${projectRoot}/`)) {
    return normalized.slice(projectRoot.length + 1)
  }
  return normalized
}

function hasRenderableSourceFile(
  operations: DesignProjectFileOperation[],
  projectRoot: string | undefined,
): boolean {
  return operations.some(operation => {
    if (operation.kind === 'delete' || !operation.content) return false
    const relativePath = projectRelativePath(operation.path, projectRoot)
    if (!relativePath.startsWith('src/') || !/\.(tsx|jsx)$/i.test(relativePath)) return false
    return !REACT_ENTRY_FILES.includes(relativePath)
  })
}

function findMissingLocalImports(
  operations: DesignProjectFileOperation[],
  projectRoot: string | undefined,
): string[] {
  const files = new Set(
    operations
      .filter(operation => operation.kind !== 'delete' && operation.content)
      .map(operation => projectRelativePath(operation.path, projectRoot)),
  )
  const missing = new Set<string>()

  for (const operation of operations) {
    if (operation.kind === 'delete' || !operation.content) continue
    const importerPath = projectRelativePath(operation.path, projectRoot)
    for (const specifier of relativeImportSpecifiers(operation.content)) {
      const resolved = resolveLocalImport(importerPath, specifier, files)
      if (!resolved) missing.add(`${importerPath} -> ${specifier}`)
    }
  }

  return [...missing].sort()
}

function relativeImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g
  const dynamicImportPattern = /\bimport\s*\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g
  collectMatches(source, importPattern, specifiers)
  collectMatches(source, dynamicImportPattern, specifiers)
  return specifiers
}

function collectMatches(source: string, pattern: RegExp, output: string[]): void {
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier) output.push(specifier)
  }
}

function resolveLocalImport(
  importerPath: string,
  specifier: string,
  files: Set<string>,
): string | undefined {
  const basePath = normalizeRelativePath(`${dirname(importerPath)}/${specifier}`)
  const candidates = importCandidates(basePath)
  return candidates.find(candidate => files.has(candidate))
}

function importCandidates(basePath: string): string[] {
  if (/\.[a-z0-9]+$/i.test(basePath)) return [basePath]
  return [
    ...SOURCE_EXTENSIONS.map(extension => `${basePath}${extension}`),
    ...INDEX_SOURCE_FILES.map(indexFile => `${basePath}/${indexFile}`),
  ]
}

function dirname(path: string): string {
  const segments = path.split('/').filter(Boolean)
  segments.pop()
  return segments.join('/')
}

function normalizeRelativePath(path: string): string {
  const output: string[] = []
  for (const segment of path.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      output.pop()
      continue
    }
    output.push(segment)
  }
  return output.join('/')
}

function packageJsonStatus(content: string | undefined): { valid: boolean; summary: string } {
  if (!content) {
    return {
      valid: false,
      summary: 'package.json is present and declares react and react-dom runtime dependencies.',
    }
  }

  const parsed = parseJson(content)
  if (!parsed.ok) {
    return {
      valid: false,
      summary: 'package.json is valid JSON.',
    }
  }

  const hasReact = Boolean(dependencyVersion(parsed.value, 'dependencies', 'react'))
  const hasReactDom = Boolean(dependencyVersion(parsed.value, 'dependencies', 'react-dom'))
  return {
    valid: hasReact && hasReactDom,
    summary: 'package.json is valid JSON with react and react-dom in dependencies.',
  }
}

function dependencyVersion(
  value: unknown,
  group: 'dependencies' | 'devDependencies',
  name: string,
): string | undefined {
  if (!isRecord(value)) return undefined
  const dependencies = value[group]
  if (!isRecord(dependencies)) return undefined
  const version = dependencies[name]
  return typeof version === 'string' && version.trim().length > 0 ? version : undefined
}

function parseJson(value: string): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as unknown }
  } catch {
    return { ok: false }
  }
}

function normalizeOperationPath(path: string): string {
  return normalizedPathSegments(path).join('/')
}

function normalizedPathSegments(path: string): string[] {
  return path.trim().replace(/^\/+/, '').split('/').filter(Boolean)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
