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
const JAVASCRIPT_SOURCE_PATTERN = /\.(tsx|ts|jsx|js)$/i
const FORBIDDEN_WORKSPACE_IMPORT_PATTERNS = [
  /from\s+['"]@\/packages\//,
  /from\s+['"]@\/apps\//,
  /from\s+['"]@telegraph\//,
  /import\s*\(\s*['"]@\/packages\//,
  /import\s*\(\s*['"]@\/apps\//,
  /import\s*\(\s*['"]@telegraph\//,
]

interface LocalImportBinding {
  specifier: string
  defaultName?: string
  named: string[]
}

interface ExportedSymbols {
  hasDefault: boolean
  named: Set<string>
}

export function evaluateStandaloneProjectFiles(
  operations: DesignProjectFileOperation[],
): StandaloneProjectContractResult {
  const projectRoot = inferSandboxProjectRoot(operations)
  const packageOperation = findProjectFileOperation(operations, ['package.json'], projectRoot)
  const packageJson = packageJsonStatus(packageOperation?.content)
  const packageJsonValue = parseJsonValue(packageOperation?.content)
  const hasIndexHtml = Boolean(findProjectFileOperation(operations, ['index.html'], projectRoot))
  const hasReactEntry = Boolean(findProjectFileOperation(operations, REACT_ENTRY_FILES, projectRoot))
  const hasAppSource = hasRenderableSourceFile(operations, projectRoot)
  const projectFiles = projectFileMap(operations, projectRoot)
  const hasStandaloneImports = operations.every(operation =>
    operation.kind === 'delete' ||
    !operation.content ||
    !FORBIDDEN_WORKSPACE_IMPORT_PATTERNS.some(pattern => pattern.test(operation.content ?? ''))
  )
  const missingLocalImports = findMissingLocalImports(operations, projectRoot)
  const localImportExportMismatches = findLocalImportExportMismatches(operations, projectRoot, projectFiles)
  const missingExternalDependencies = findMissingExternalDependencies(operations, projectRoot, packageJsonValue)
  const aliasSpecifiers = findAliasImportSpecifiers(operations, projectRoot)
  const aliasConfigured = aliasSpecifiers.length === 0 || hasAliasConfig(projectFiles)
  const shadcnProject = hasShadcnSignal(projectFiles, aliasSpecifiers)
  const missingShadcnLocalFiles = findMissingShadcnLocalFiles(aliasSpecifiers, projectFiles)
  const provenanceStatus = shadcnProvenanceStatus(projectFiles)
  const cnStatus = cnHelperStatus(operations, projectRoot, projectFiles, packageJsonValue)
  const missingRadixDependencies = findMissingRadixDependencies(operations, projectRoot, packageJsonValue)
  const tokenStatus = themeTokenStatus(projectFiles)
  const rawColorStatus = rawColorStatusForProject(operations, projectRoot)

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
      id: 'standalone-local-import-exports',
      passed: localImportExportMismatches.length === 0,
      summary: localImportExportMismatches.length === 0
        ? 'Local relative imports match default and named exports.'
        : `Local import/export mismatches: ${localImportExportMismatches.slice(0, 5).join(', ')}`,
    },
    {
      id: 'standalone-imports',
      passed: hasStandaloneImports,
      summary: 'Project source does not import Telegraph workspace-only modules.',
    },
    {
      id: 'standalone-external-dependencies',
      passed: missingExternalDependencies.length === 0,
      summary: missingExternalDependencies.length === 0
        ? 'External source imports are declared in package.json dependencies or devDependencies.'
        : `Missing package.json dependencies for imports: ${missingExternalDependencies.slice(0, 8).join(', ')}`,
    },
    {
      id: 'standalone-alias-config',
      passed: aliasConfigured,
      summary: aliasConfigured
        ? '@/ imports have matching vite.config.ts and tsconfig.json alias configuration, or are not used.'
        : `@/ imports require alias configuration: ${aliasSpecifiers.slice(0, 5).join(', ')}`,
    },
    {
      id: 'standalone-shadcn-components-json',
      passed: !shadcnProject || projectFiles.has('components.json'),
      summary: 'shadcn projects include components.json with local component aliases.',
    },
    {
      id: 'standalone-shadcn-local-files',
      passed: missingShadcnLocalFiles.length === 0,
      summary: missingShadcnLocalFiles.length === 0
        ? '@/components/ui imports resolve to local generated files.'
        : `Missing local shadcn UI files: ${missingShadcnLocalFiles.slice(0, 8).join(', ')}`,
    },
    {
      id: 'standalone-shadcn-provenance',
      passed: !shadcnProject || provenanceStatus.valid,
      summary: provenanceStatus.summary,
    },
    {
      id: 'standalone-no-fake-primitives',
      passed: !shadcnProject || provenanceStatus.valid,
      summary: 'shadcn primitive files are backed by design-system provenance or the project is not using shadcn primitives.',
    },
    {
      id: 'standalone-cn-helper',
      passed: cnStatus.valid,
      summary: cnStatus.summary,
    },
    {
      id: 'standalone-radix-deps',
      passed: missingRadixDependencies.length === 0,
      summary: missingRadixDependencies.length === 0
        ? 'Radix primitive imports are declared in package.json.'
        : `Missing Radix dependencies: ${missingRadixDependencies.slice(0, 8).join(', ')}`,
    },
    {
      id: 'standalone-theme-tokens-present',
      passed: !shadcnProject || tokenStatus.valid,
      summary: tokenStatus.summary,
    },
    {
      id: 'standalone-no-raw-colors',
      passed: !shadcnProject || rawColorStatus.valid,
      summary: rawColorStatus.summary,
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

function findLocalImportExportMismatches(
  operations: DesignProjectFileOperation[],
  projectRoot: string | undefined,
  files: Map<string, string>,
): string[] {
  const filePaths = new Set(files.keys())
  const mismatches = new Set<string>()

  for (const operation of sourceOperations(operations, projectRoot)) {
    const importerPath = projectRelativePath(operation.path, projectRoot)
    for (const binding of localImportBindings(operation.content ?? '')) {
      const resolved = resolveLocalImport(importerPath, binding.specifier, filePaths)
      if (!resolved || !JAVASCRIPT_SOURCE_PATTERN.test(resolved)) continue
      const targetSource = files.get(resolved)
      if (!targetSource) continue
      const targetExports = exportedSymbols(targetSource)
      if (binding.defaultName && !targetExports.hasDefault) {
        mismatches.add(`${importerPath} -> ${binding.specifier} default`)
      }
      for (const name of binding.named) {
        if (name === 'default') {
          if (!targetExports.hasDefault) mismatches.add(`${importerPath} -> ${binding.specifier} default`)
          continue
        }
        if (!targetExports.named.has(name)) {
          mismatches.add(`${importerPath} -> ${binding.specifier} { ${name} }`)
        }
      }
    }
  }

  return [...mismatches].sort()
}

function localImportBindings(source: string): LocalImportBinding[] {
  const bindings: LocalImportBinding[] = []
  const importPattern = /^[ \t]*import\s+(type\s+)?([^'"\n][^\n]*?)\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/gm
  const exportFromPattern = /^[ \t]*export\s+(type\s+)?\{([^}\n]*?)\}\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/gm

  for (const match of source.matchAll(importPattern)) {
    const clause = match[2].trim()
    const specifier = match[3]
    if (!clause || !specifier) continue
    bindings.push({
      specifier,
      defaultName: defaultImportName(clause),
      named: namedBindingImports(clause),
    })
  }

  for (const match of source.matchAll(exportFromPattern)) {
    const clause = match[2].trim()
    const specifier = match[3]
    if (!clause || !specifier) continue
    bindings.push({
      specifier,
      named: namedBindingImports(`{${clause}}`),
    })
  }

  return bindings
}

function defaultImportName(clause: string): string | undefined {
  const first = clause.split(',')[0]?.trim()
  if (!first || first.startsWith('{') || first.startsWith('*')) return undefined
  return first.replace(/^type\s+/, '').trim() || undefined
}

function namedBindingImports(clause: string): string[] {
  const namedBlock = clause.match(/\{([\s\S]*?)\}/)?.[1]
  if (!namedBlock) return []
  return namedBlock
    .split(',')
    .map(part => part.trim().replace(/^type\s+/, ''))
    .map(part => part.split(/\s+as\s+/i)[0]?.trim())
    .filter((name): name is string => Boolean(name))
}

function exportedSymbols(source: string): ExportedSymbols {
  const named = new Set<string>()
  const declarationPattern = /\bexport\s+(?:declare\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g
  const exportListPattern = /\bexport\s*\{([\s\S]*?)\}/g

  for (const match of source.matchAll(declarationPattern)) {
    const name = match[1]
    if (name) named.add(name)
  }

  for (const match of source.matchAll(exportListPattern)) {
    const block = match[1]
    if (!block) continue
    for (const exportName of exportedNamesFromList(block)) {
      named.add(exportName)
    }
  }

  return {
    hasDefault: /\bexport\s+default\b/.test(source) || /\bexport\s*\{[\s\S]*?\bas\s+default\b[\s\S]*?\}/.test(source),
    named,
  }
}

function exportedNamesFromList(block: string): string[] {
  return block
    .split(',')
    .map(part => part.trim())
    .map(part => {
      const pieces = part.split(/\s+as\s+/i)
      return (pieces[1] ?? pieces[0]).trim()
    })
    .filter((name): name is string => Boolean(name && name !== 'default'))
}

function projectFileMap(
  operations: DesignProjectFileOperation[],
  projectRoot: string | undefined,
): Map<string, string> {
  return new Map(
    operations
      .filter(operation => operation.kind !== 'delete' && operation.content)
      .map(operation => [projectRelativePath(operation.path, projectRoot), operation.content ?? '']),
  )
}

function findMissingExternalDependencies(
  operations: DesignProjectFileOperation[],
  projectRoot: string | undefined,
  packageJson: unknown,
): string[] {
  const declared = packageDependencyNames(packageJson)
  const imports = new Set<string>()
  for (const operation of sourceOperations(operations, projectRoot)) {
    for (const specifier of importSpecifiers(operation.content ?? '')) {
      const packageName = externalPackageName(specifier)
      if (packageName) imports.add(packageName)
    }
  }
  return [...imports].filter(name => !declared.has(name)).sort()
}

function findAliasImportSpecifiers(
  operations: DesignProjectFileOperation[],
  projectRoot: string | undefined,
): string[] {
  const specifiers = new Set<string>()
  for (const operation of sourceOperations(operations, projectRoot)) {
    for (const specifier of importSpecifiers(operation.content ?? '')) {
      if (specifier.startsWith('@/')) specifiers.add(specifier)
    }
  }
  return [...specifiers].sort()
}

function hasAliasConfig(files: Map<string, string>): boolean {
  const viteConfig = files.get('vite.config.ts') ?? files.get('vite.config.js') ?? ''
  const tsconfig = files.get('tsconfig.json') ?? ''
  return /['"]@['"]\s*:/.test(viteConfig) && /"@\/\*"\s*:/.test(tsconfig)
}

function hasShadcnSignal(files: Map<string, string>, aliasSpecifiers: string[]): boolean {
  return files.has('components.json') ||
    files.has('design-system.provenance.json') ||
    [...files.keys()].some(path => path.startsWith('src/components/ui/')) ||
    aliasSpecifiers.some(specifier => specifier.startsWith('@/components/ui/'))
}

function findMissingShadcnLocalFiles(aliasSpecifiers: string[], files: Map<string, string>): string[] {
  const missing = new Set<string>()
  for (const specifier of aliasSpecifiers) {
    if (!specifier.startsWith('@/components/ui/')) continue
    const relative = specifier.replace(/^@\//, 'src/')
    if (!resolveAliasFile(relative, files)) missing.add(specifier)
  }
  return [...missing].sort()
}

function resolveAliasFile(relative: string, files: Map<string, string>): string | undefined {
  return importCandidates(relative).find(candidate => files.has(candidate))
}

function shadcnProvenanceStatus(files: Map<string, string>): { valid: boolean; summary: string } {
  const uiFiles = [...files.keys()].filter(path => path.startsWith('src/components/ui/') && /\.(tsx|jsx)$/i.test(path))
  if (uiFiles.length === 0) {
    return { valid: true, summary: 'No local shadcn primitive files require provenance.' }
  }
  const provenance = files.get('design-system.provenance.json')
  if (!provenance) {
    return { valid: false, summary: 'Local shadcn primitive files require design-system.provenance.json.' }
  }
  const parsed = parseJsonValue(provenance)
  const components = isRecord(parsed) && Array.isArray(parsed.components) ? parsed.components : []
  const componentNames = new Set(
    components
      .filter(isRecord)
      .map(component => typeof component.name === 'string' ? component.name : undefined)
      .filter((name): name is string => Boolean(name)),
  )
  const missing = uiFiles
    .map(path => path.split('/').at(-1)?.replace(/\.(tsx|jsx)$/i, ''))
    .filter((name): name is string => Boolean(name))
    .filter(name => !componentNames.has(name))
  return {
    valid: missing.length === 0,
    summary: missing.length === 0
      ? 'Local shadcn primitive files have design-system provenance.'
      : `Missing provenance entries for shadcn primitives: ${missing.slice(0, 8).join(', ')}`,
  }
}

function cnHelperStatus(
  operations: DesignProjectFileOperation[],
  projectRoot: string | undefined,
  files: Map<string, string>,
  packageJson: unknown,
): { valid: boolean; summary: string } {
  const usesCn = sourceOperations(operations, projectRoot).some(operation =>
    /from\s+['"]@\/lib\/utils['"]/.test(operation.content ?? '') ||
    /\bcn\s*\(/.test(operation.content ?? '')
  )
  if (!usesCn) return { valid: true, summary: 'Project does not use cn(), or no cn helper is required.' }
  const declared = packageDependencyNames(packageJson)
  const missingDeps = ['clsx', 'tailwind-merge'].filter(name => !declared.has(name))
  const hasUtils = files.has('src/lib/utils.ts') || files.has('src/lib/utils.tsx')
  return {
    valid: hasUtils && missingDeps.length === 0,
    summary: hasUtils && missingDeps.length === 0
      ? 'cn() usage has src/lib/utils.ts and clsx/tailwind-merge dependencies.'
      : `cn() usage requires ${[
          hasUtils ? undefined : 'src/lib/utils.ts',
          ...missingDeps,
        ].filter(Boolean).join(', ')}.`,
  }
}

function findMissingRadixDependencies(
  operations: DesignProjectFileOperation[],
  projectRoot: string | undefined,
  packageJson: unknown,
): string[] {
  const declared = packageDependencyNames(packageJson)
  const radixImports = new Set<string>()
  for (const operation of sourceOperations(operations, projectRoot)) {
    for (const specifier of importSpecifiers(operation.content ?? '')) {
      if (specifier.startsWith('@radix-ui/react-')) radixImports.add(specifier)
    }
  }
  return [...radixImports].filter(name => !declared.has(name)).sort()
}

function themeTokenStatus(files: Map<string, string>): { valid: boolean; summary: string } {
  const styles = files.get('src/styles.css') ?? ''
  const required = ['--background', '--foreground', '--primary', '--primary-foreground', '--border', '--input', '--ring', '--radius']
  const missing = required.filter(token => !styles.includes(token))
  return {
    valid: missing.length === 0,
    summary: missing.length === 0
      ? 'Theme CSS includes required shadcn semantic tokens.'
      : `Missing required theme tokens: ${missing.join(', ')}`,
  }
}

function rawColorStatusForProject(
  operations: DesignProjectFileOperation[],
  projectRoot: string | undefined,
): { valid: boolean; summary: string } {
  const offenders: string[] = []
  const rawColorPattern = /#[0-9a-f]{3,8}\b/gi
  for (const operation of operations) {
    if (operation.kind === 'delete' || !operation.content) continue
    const relativePath = projectRelativePath(operation.path, projectRoot)
    if (!/\.(tsx|ts|jsx|js|css)$/i.test(relativePath)) continue
    if (relativePath === 'src/styles.css') {
      const nonTokenLines = operation.content
        .split('\n')
        .filter(line => {
          rawColorPattern.lastIndex = 0
          return rawColorPattern.test(line) && !/^\s*--[a-z0-9-]+\s*:/i.test(line)
        })
      if (nonTokenLines.length > 0) offenders.push(relativePath)
      continue
    }
    rawColorPattern.lastIndex = 0
    if (rawColorPattern.test(operation.content)) offenders.push(relativePath)
  }
  return {
    valid: offenders.length === 0,
    summary: offenders.length === 0
      ? 'Raw hex colors are limited to theme token definitions.'
      : `Raw hex colors found outside theme token definitions: ${offenders.slice(0, 8).join(', ')}`,
  }
}

function sourceOperations(
  operations: DesignProjectFileOperation[],
  projectRoot: string | undefined,
): DesignProjectFileOperation[] {
  return operations.filter(operation => {
    if (operation.kind === 'delete' || !operation.content) return false
    const relativePath = projectRelativePath(operation.path, projectRoot)
    return /\.(tsx|ts|jsx|js)$/i.test(relativePath)
  })
}

function importSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const importPattern = /\b(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g
  const dynamicImportPattern = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  collectMatches(source, importPattern, specifiers)
  collectMatches(source, dynamicImportPattern, specifiers)
  return specifiers
}

function externalPackageName(specifier: string): string | undefined {
  if (specifier.startsWith('.') || specifier.startsWith('/') || specifier.startsWith('@/')) return undefined
  if (/^(node|data|https?):/.test(specifier)) return undefined
  const segments = specifier.split('/')
  return specifier.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0]
}

function packageDependencyNames(packageJson: unknown): Set<string> {
  const names = new Set<string>()
  if (!isRecord(packageJson)) return names
  for (const group of ['dependencies', 'devDependencies'] as const) {
    const dependencies = packageJson[group]
    if (!isRecord(dependencies)) continue
    for (const name of Object.keys(dependencies)) names.add(name)
  }
  return names
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

function parseJsonValue(value: string | undefined): unknown {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
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
