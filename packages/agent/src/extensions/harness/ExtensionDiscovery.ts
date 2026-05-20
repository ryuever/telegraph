import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  parseHarnessExtensionManifest,
  type HarnessExtensionManifest,
  type HarnessExtensionPackage,
  type HarnessExtensionSourceKind,
} from './HarnessExtensionManifest'

export async function loadHarnessExtensionPackage(
  rootPath: string,
  sourceKind: HarnessExtensionSourceKind,
): Promise<HarnessExtensionPackage> {
  const manifest = await loadHarnessExtensionManifest(rootPath)
  return {
    manifest,
    rootPath,
    sourceKind,
  }
}

export async function loadHarnessExtensionManifest(rootPath: string): Promise<HarnessExtensionManifest> {
  const manifestPath = join(rootPath, 'telegraph.extension.json')
  const raw = await readFile(manifestPath, 'utf8')
  return parseHarnessExtensionManifest(JSON.parse(raw))
}
