/**
 * Filesystem discovery and manifest loading for harness extension packages.
 *
 * Migrated from `@/packages/agent-extension-host` as part of D-016 P5.
 * The new command-style extension loader lives in `../discovery.ts`; this
 * module continues to serve the declarative harness-extension model used by
 * the in-tree `@telegraph/subagents` extension during the parity window.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  type Dirent,
  type Stats,
} from 'node:fs'
import {
  readdir,
  readFile,
  stat,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  parseHarnessExtensionManifest,
  type HarnessExtensionManifest,
  type HarnessExtensionPackage,
  type HarnessExtensionSourceKind,
} from './HarnessExtensionManifest'

export const HARNESS_EXTENSION_MANIFEST_FILENAME = 'telegraph.extension.json'

export type HarnessExtensionLoadDiagnosticCode =
  | 'extension_root_missing'
  | 'extension_root_not_directory'
  | 'extension_dir_read_failed'
  | 'manifest_missing'
  | 'manifest_not_file'
  | 'manifest_read_failed'
  | 'manifest_parse_failed'

export interface HarnessExtensionLoadDiagnostic {
  type: 'warning' | 'error'
  code: HarnessExtensionLoadDiagnosticCode
  message: string
  path: string
  sourceKind: HarnessExtensionSourceKind
}

export interface HarnessExtensionLoadSource {
  rootPath: string
  sourceKind: HarnessExtensionSourceKind
  required?: boolean
}

export interface HarnessExtensionDirectorySource {
  dirPath: string
  sourceKind: HarnessExtensionSourceKind
  required?: boolean
  includeSelf?: boolean
  includeChildren?: boolean
}

export interface HarnessExtensionSourceDiscoveryResult {
  sources: HarnessExtensionLoadSource[]
  diagnostics: HarnessExtensionLoadDiagnostic[]
}

export interface HarnessExtensionLoadResult {
  packages: HarnessExtensionPackage[]
  diagnostics: HarnessExtensionLoadDiagnostic[]
}

export async function loadHarnessExtensionPackage(
  rootPath: string,
  sourceKind: HarnessExtensionSourceKind,
): Promise<HarnessExtensionPackage> {
  const manifest = await loadHarnessExtensionManifest(rootPath)
  const resolvedRootPath = resolve(rootPath)
  return {
    manifest,
    rootPath: resolvedRootPath,
    manifestPath: resolveHarnessExtensionManifestPath(resolvedRootPath),
    mainPath: resolveHarnessExtensionMainPath(resolvedRootPath, manifest.main),
    sourceKind,
  }
}

export function loadHarnessExtensionPackageSync(
  rootPath: string,
  sourceKind: HarnessExtensionSourceKind,
): HarnessExtensionPackage {
  const manifest = loadHarnessExtensionManifestSync(rootPath)
  const resolvedRootPath = resolve(rootPath)
  return {
    manifest,
    rootPath: resolvedRootPath,
    manifestPath: resolveHarnessExtensionManifestPath(resolvedRootPath),
    mainPath: resolveHarnessExtensionMainPath(resolvedRootPath, manifest.main),
    sourceKind,
  }
}

export async function loadHarnessExtensionManifest(rootPath: string): Promise<HarnessExtensionManifest> {
  const manifestPath = resolveHarnessExtensionManifestPath(rootPath)
  const raw = await readFile(manifestPath, 'utf8')
  return parseHarnessExtensionManifest(JSON.parse(raw))
}

export function loadHarnessExtensionManifestSync(rootPath: string): HarnessExtensionManifest {
  const manifestPath = resolveHarnessExtensionManifestPath(rootPath)
  const raw = readFileSync(manifestPath, 'utf8')
  return parseHarnessExtensionManifest(JSON.parse(raw))
}

export async function discoverHarnessExtensionSourcesFromDirs(
  dirs: HarnessExtensionDirectorySource[],
): Promise<HarnessExtensionSourceDiscoveryResult> {
  const sources = new Map<string, HarnessExtensionLoadSource>()
  const diagnostics: HarnessExtensionLoadDiagnostic[] = []

  for (const dir of dirs) {
    const resolvedDirPath = resolve(dir.dirPath)
    const includeSelf = dir.includeSelf ?? true
    const includeChildren = dir.includeChildren ?? true

    let stats: Stats
    try {
      stats = await stat(resolvedDirPath)
    } catch {
      diagnostics.push(missingRootDiagnostic(resolvedDirPath, dir))
      continue
    }

    if (!stats.isDirectory()) {
      diagnostics.push(notDirectoryDiagnostic(resolvedDirPath, dir))
      continue
    }

    if (includeSelf && await hasHarnessExtensionManifest(resolvedDirPath)) {
      addSource(sources, { rootPath: resolvedDirPath, sourceKind: dir.sourceKind, required: dir.required })
    }

    if (!includeChildren) continue

    let entries: Dirent[]
    try {
      entries = await readdir(resolvedDirPath, { withFileTypes: true })
    } catch (error) {
      diagnostics.push(readDirFailedDiagnostic(resolvedDirPath, dir, error))
      continue
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      const rootPath = join(resolvedDirPath, entry.name)
      if (!await hasHarnessExtensionManifest(rootPath)) continue
      addSource(sources, { rootPath, sourceKind: dir.sourceKind, required: dir.required })
    }
  }

  return { sources: [...sources.values()], diagnostics }
}

export function discoverHarnessExtensionSourcesFromDirsSync(
  dirs: HarnessExtensionDirectorySource[],
): HarnessExtensionSourceDiscoveryResult {
  const sources = new Map<string, HarnessExtensionLoadSource>()
  const diagnostics: HarnessExtensionLoadDiagnostic[] = []

  for (const dir of dirs) {
    const resolvedDirPath = resolve(dir.dirPath)
    const includeSelf = dir.includeSelf ?? true
    const includeChildren = dir.includeChildren ?? true

    if (!existsSync(resolvedDirPath)) {
      diagnostics.push(missingRootDiagnostic(resolvedDirPath, dir))
      continue
    }

    let stats: Stats
    try {
      stats = statSync(resolvedDirPath)
    } catch (error) {
      diagnostics.push(readDirFailedDiagnostic(resolvedDirPath, dir, error))
      continue
    }

    if (!stats.isDirectory()) {
      diagnostics.push(notDirectoryDiagnostic(resolvedDirPath, dir))
      continue
    }

    if (includeSelf && hasHarnessExtensionManifestSync(resolvedDirPath)) {
      addSource(sources, { rootPath: resolvedDirPath, sourceKind: dir.sourceKind, required: dir.required })
    }

    if (!includeChildren) continue

    let entries: Dirent[]
    try {
      entries = readdirSync(resolvedDirPath, { withFileTypes: true })
    } catch (error) {
      diagnostics.push(readDirFailedDiagnostic(resolvedDirPath, dir, error))
      continue
    }

    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue
      const rootPath = join(resolvedDirPath, entry.name)
      if (!hasHarnessExtensionManifestSync(rootPath)) continue
      addSource(sources, { rootPath, sourceKind: dir.sourceKind, required: dir.required })
    }
  }

  return { sources: [...sources.values()], diagnostics }
}

export async function loadHarnessExtensionPackages(
  sources: HarnessExtensionLoadSource[],
): Promise<HarnessExtensionLoadResult> {
  const packages: HarnessExtensionPackage[] = []
  const diagnostics: HarnessExtensionLoadDiagnostic[] = []

  for (const source of uniqueSources(sources)) {
    const loaded = await tryLoadHarnessExtensionPackage(source)
    if (loaded.pkg) packages.push(loaded.pkg)
    diagnostics.push(...loaded.diagnostics)
  }

  return { packages, diagnostics }
}

export function loadHarnessExtensionPackagesSync(
  sources: HarnessExtensionLoadSource[],
): HarnessExtensionLoadResult {
  const packages: HarnessExtensionPackage[] = []
  const diagnostics: HarnessExtensionLoadDiagnostic[] = []

  for (const source of uniqueSources(sources)) {
    const loaded = tryLoadHarnessExtensionPackageSync(source)
    if (loaded.pkg) packages.push(loaded.pkg)
    diagnostics.push(...loaded.diagnostics)
  }

  return { packages, diagnostics }
}

export async function loadHarnessExtensionPackagesFromDirs(
  dirs: HarnessExtensionDirectorySource[],
): Promise<HarnessExtensionLoadResult> {
  const discovered = await discoverHarnessExtensionSourcesFromDirs(dirs)
  const loaded = await loadHarnessExtensionPackages(discovered.sources)
  return {
    packages: loaded.packages,
    diagnostics: [...discovered.diagnostics, ...loaded.diagnostics],
  }
}

export function loadHarnessExtensionPackagesFromDirsSync(
  dirs: HarnessExtensionDirectorySource[],
): HarnessExtensionLoadResult {
  const discovered = discoverHarnessExtensionSourcesFromDirsSync(dirs)
  const loaded = loadHarnessExtensionPackagesSync(discovered.sources)
  return {
    packages: loaded.packages,
    diagnostics: [...discovered.diagnostics, ...loaded.diagnostics],
  }
}

export async function hasHarnessExtensionManifest(rootPath: string): Promise<boolean> {
  try {
    const stats = await stat(resolveHarnessExtensionManifestPath(rootPath))
    return stats.isFile()
  } catch {
    return false
  }
}

export function hasHarnessExtensionManifestSync(rootPath: string): boolean {
  try {
    return statSync(resolveHarnessExtensionManifestPath(rootPath)).isFile()
  } catch {
    return false
  }
}

export function resolveHarnessExtensionManifestPath(rootPath: string): string {
  return join(resolve(rootPath), HARNESS_EXTENSION_MANIFEST_FILENAME)
}

export function resolveHarnessExtensionMainPath(
  rootPath: string,
  main: string | undefined,
): string | undefined {
  if (!main || isUri(main)) return undefined
  return resolve(rootPath, main)
}

async function tryLoadHarnessExtensionPackage(
  source: HarnessExtensionLoadSource,
): Promise<{ pkg?: HarnessExtensionPackage; diagnostics: HarnessExtensionLoadDiagnostic[] }> {
  const rootPath = resolve(source.rootPath)
  const rootResult = await validateExtensionRoot(rootPath, source)
  if (rootResult) return { diagnostics: [rootResult] }

  const manifestPath = resolveHarnessExtensionManifestPath(rootPath)
  const manifestResult = await validateExtensionManifestFile(manifestPath, source)
  if (manifestResult) return { diagnostics: [manifestResult] }

  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch (error) {
    return {
      diagnostics: [readManifestFailedDiagnostic(manifestPath, source, error)],
    }
  }

  try {
    const manifest = parseHarnessExtensionManifest(JSON.parse(raw))
    return {
      pkg: {
        manifest,
        rootPath,
        manifestPath,
        mainPath: resolveHarnessExtensionMainPath(rootPath, manifest.main),
        sourceKind: source.sourceKind,
      },
      diagnostics: [],
    }
  } catch (error) {
    return {
      diagnostics: [parseFailedDiagnostic(manifestPath, source, error)],
    }
  }
}

function tryLoadHarnessExtensionPackageSync(
  source: HarnessExtensionLoadSource,
): { pkg?: HarnessExtensionPackage; diagnostics: HarnessExtensionLoadDiagnostic[] } {
  const rootPath = resolve(source.rootPath)
  const rootResult = validateExtensionRootSync(rootPath, source)
  if (rootResult) return { diagnostics: [rootResult] }

  const manifestPath = resolveHarnessExtensionManifestPath(rootPath)
  const manifestResult = validateExtensionManifestFileSync(manifestPath, source)
  if (manifestResult) return { diagnostics: [manifestResult] }

  let raw: string
  try {
    raw = readFileSync(manifestPath, 'utf8')
  } catch (error) {
    return {
      diagnostics: [readManifestFailedDiagnostic(manifestPath, source, error)],
    }
  }

  try {
    const manifest = parseHarnessExtensionManifest(JSON.parse(raw))
    return {
      pkg: {
        manifest,
        rootPath,
        manifestPath,
        mainPath: resolveHarnessExtensionMainPath(rootPath, manifest.main),
        sourceKind: source.sourceKind,
      },
      diagnostics: [],
    }
  } catch (error) {
    return {
      diagnostics: [parseFailedDiagnostic(manifestPath, source, error)],
    }
  }
}

async function validateExtensionRoot(
  rootPath: string,
  source: HarnessExtensionLoadSource,
): Promise<HarnessExtensionLoadDiagnostic | undefined> {
  try {
    const stats = await stat(rootPath)
    return stats.isDirectory() ? undefined : notDirectoryDiagnostic(rootPath, source)
  } catch {
    return missingRootDiagnostic(rootPath, source)
  }
}

function validateExtensionRootSync(
  rootPath: string,
  source: HarnessExtensionLoadSource,
): HarnessExtensionLoadDiagnostic | undefined {
  if (!existsSync(rootPath)) return missingRootDiagnostic(rootPath, source)
  try {
    const stats = statSync(rootPath)
    return stats.isDirectory() ? undefined : notDirectoryDiagnostic(rootPath, source)
  } catch (error) {
    return readDirFailedDiagnostic(rootPath, source, error)
  }
}

async function validateExtensionManifestFile(
  manifestPath: string,
  source: HarnessExtensionLoadSource,
): Promise<HarnessExtensionLoadDiagnostic | undefined> {
  try {
    const stats = await stat(manifestPath)
    return stats.isFile() ? undefined : {
      type: 'error',
      code: 'manifest_not_file',
      message: 'extension manifest path is not a file',
      path: manifestPath,
      sourceKind: source.sourceKind,
    }
  } catch {
    return missingManifestDiagnostic(manifestPath, source)
  }
}

function validateExtensionManifestFileSync(
  manifestPath: string,
  source: HarnessExtensionLoadSource,
): HarnessExtensionLoadDiagnostic | undefined {
  if (!existsSync(manifestPath)) return missingManifestDiagnostic(manifestPath, source)
  try {
    const stats = statSync(manifestPath)
    return stats.isFile() ? undefined : {
      type: 'error',
      code: 'manifest_not_file',
      message: 'extension manifest path is not a file',
      path: manifestPath,
      sourceKind: source.sourceKind,
    }
  } catch (error) {
    return {
      type: 'error',
      code: 'manifest_read_failed',
      message: error instanceof Error ? error.message : 'failed to stat extension manifest',
      path: manifestPath,
      sourceKind: source.sourceKind,
    }
  }
}

function missingRootDiagnostic(
  path: string,
  source: HarnessExtensionLoadSource | HarnessExtensionDirectorySource,
): HarnessExtensionLoadDiagnostic {
  return {
    type: source.required ? 'error' : 'warning',
    code: 'extension_root_missing',
    message: 'extension root does not exist',
    path,
    sourceKind: source.sourceKind,
  }
}

function notDirectoryDiagnostic(
  path: string,
  source: HarnessExtensionLoadSource | HarnessExtensionDirectorySource,
): HarnessExtensionLoadDiagnostic {
  return {
    type: 'error',
    code: 'extension_root_not_directory',
    message: 'extension root is not a directory',
    path,
    sourceKind: source.sourceKind,
  }
}

function readDirFailedDiagnostic(
  path: string,
  source: HarnessExtensionLoadSource | HarnessExtensionDirectorySource,
  error: unknown,
): HarnessExtensionLoadDiagnostic {
  return {
    type: 'error',
    code: 'extension_dir_read_failed',
    message: error instanceof Error ? error.message : 'failed to read extension directory',
    path,
    sourceKind: source.sourceKind,
  }
}

function missingManifestDiagnostic(
  manifestPath: string,
  source: HarnessExtensionLoadSource,
): HarnessExtensionLoadDiagnostic {
  return {
    type: source.required ? 'error' : 'warning',
    code: 'manifest_missing',
    message: 'extension manifest does not exist',
    path: manifestPath,
    sourceKind: source.sourceKind,
  }
}

function parseFailedDiagnostic(
  manifestPath: string,
  source: HarnessExtensionLoadSource,
  error: unknown,
): HarnessExtensionLoadDiagnostic {
  return {
    type: 'error',
    code: 'manifest_parse_failed',
    message: error instanceof Error ? error.message : 'failed to parse extension manifest',
    path: manifestPath,
    sourceKind: source.sourceKind,
  }
}

function readManifestFailedDiagnostic(
  manifestPath: string,
  source: HarnessExtensionLoadSource,
  error: unknown,
): HarnessExtensionLoadDiagnostic {
  return {
    type: 'error',
    code: 'manifest_read_failed',
    message: error instanceof Error ? error.message : 'failed to read extension manifest',
    path: manifestPath,
    sourceKind: source.sourceKind,
  }
}

function addSource(
  sources: Map<string, HarnessExtensionLoadSource>,
  source: HarnessExtensionLoadSource,
): void {
  const resolvedRootPath = resolve(source.rootPath)
  if (sources.has(resolvedRootPath)) return
  sources.set(resolvedRootPath, {
    ...source,
    rootPath: resolvedRootPath,
  })
}

function uniqueSources(sources: HarnessExtensionLoadSource[]): HarnessExtensionLoadSource[] {
  const unique = new Map<string, HarnessExtensionLoadSource>()
  for (const source of sources) {
    addSource(unique, source)
  }
  return [...unique.values()]
}

function isUri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value)
}
