import { readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { EXTENSION_MANIFEST_FILENAME, ExtensionManifestError, parseExtensionManifest } from './manifest'
import type { ExtensionPackage } from './types'

/**
 * Diagnostic emitted when discovery / loading skips or fails on a candidate.
 * Failures are reported, not thrown — the host should keep loading other extensions.
 */
export interface DiscoveryDiagnostic {
  type: 'warning' | 'error'
  code:
    | 'root_missing'
    | 'root_not_directory'
    | 'manifest_missing'
    | 'manifest_parse_failed'
    | 'manifest_read_failed'
    | 'main_unresolvable'
  message: string
  path: string
}

export interface DiscoveryResult {
  packages: ExtensionPackage[]
  diagnostics: DiscoveryDiagnostic[]
}

/**
 * Load a single extension package from a directory containing `telegraph.extension.json`.
 * Returns either the package or a single diagnostic explaining the failure.
 */
export async function loadExtensionPackage(rootPath: string): Promise<DiscoveryResult> {
  const resolvedRoot = resolve(rootPath)
  const diagnostics: DiscoveryDiagnostic[] = []

  let stats
  try {
    stats = await stat(resolvedRoot)
  } catch {
    diagnostics.push({ type: 'warning', code: 'root_missing', message: 'extension root does not exist', path: resolvedRoot })
    return { packages: [], diagnostics }
  }
  if (!stats.isDirectory()) {
    diagnostics.push({ type: 'error', code: 'root_not_directory', message: 'extension root is not a directory', path: resolvedRoot })
    return { packages: [], diagnostics }
  }

  const manifestPath = join(resolvedRoot, EXTENSION_MANIFEST_FILENAME)
  let raw: string
  try {
    raw = await readFile(manifestPath, 'utf8')
  } catch {
    diagnostics.push({ type: 'warning', code: 'manifest_missing', message: 'telegraph.extension.json not found', path: manifestPath })
    return { packages: [], diagnostics }
  }

  let manifest
  try {
    manifest = parseExtensionManifest(JSON.parse(raw))
  } catch (error) {
    const message =
      error instanceof ExtensionManifestError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'failed to parse manifest'
    diagnostics.push({ type: 'error', code: 'manifest_parse_failed', message, path: manifestPath })
    return { packages: [], diagnostics }
  }

  const mainPath = resolveMainPath(resolvedRoot, manifest.main)
  if (!mainPath) {
    diagnostics.push({
      type: 'error',
      code: 'main_unresolvable',
      message: `manifest.main "${manifest.main}" could not be resolved to a local path`,
      path: manifestPath,
    })
    return { packages: [], diagnostics }
  }

  return {
    packages: [{ manifest, rootPath: resolvedRoot, manifestPath, mainPath }],
    diagnostics,
  }
}

/**
 * Scan a parent directory whose immediate children are extension roots
 * (the common `extensions/<id>/` layout used by telegraph). Children without a
 * manifest are silently skipped (no diagnostic — the parent dir is allowed to
 * contain unrelated subdirs).
 */
export async function discoverExtensionsInDirectory(dirPath: string): Promise<DiscoveryResult> {
  const resolved = resolve(dirPath)
  const aggregate: DiscoveryResult = { packages: [], diagnostics: [] }

  let stats
  try {
    stats = await stat(resolved)
  } catch {
    aggregate.diagnostics.push({ type: 'warning', code: 'root_missing', message: 'extensions directory does not exist', path: resolved })
    return aggregate
  }
  if (!stats.isDirectory()) {
    aggregate.diagnostics.push({ type: 'error', code: 'root_not_directory', message: 'extensions path is not a directory', path: resolved })
    return aggregate
  }

  const entries = await readdir(resolved, { withFileTypes: true })
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue
    const childRoot = join(resolved, entry.name)
    const childManifest = join(childRoot, EXTENSION_MANIFEST_FILENAME)
    try {
      const manifestStat = await stat(childManifest)
      if (!manifestStat.isFile()) continue
    } catch {
      continue
    }
    const result = await loadExtensionPackage(childRoot)
    aggregate.packages.push(...result.packages)
    aggregate.diagnostics.push(...result.diagnostics)
  }

  return aggregate
}

function resolveMainPath(rootPath: string, main: string): string | undefined {
  if (!main) return undefined
  // URLs (e.g. data: or http:) are not supported in P4 — extension factories must live on disk.
  if (/^[a-z][a-z0-9+.-]*:/i.test(main)) return undefined
  return isAbsolute(main) ? main : resolve(rootPath, main)
}
