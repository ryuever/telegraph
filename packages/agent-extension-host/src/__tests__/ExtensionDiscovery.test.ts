import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  HARNESS_EXTENSION_MANIFEST_FILENAME,
  discoverHarnessExtensionSourcesFromDirsSync,
  loadHarnessExtensionPackageSync,
  loadHarnessExtensionPackagesFromDirs,
  loadHarnessExtensionPackagesFromDirsSync,
  resolveHarnessExtensionManifestPath,
} from '@/packages/agent-extension-host'

function fixtureDir(name: string): string {
  return join(tmpdir(), `telegraph-agent-extension-host-${name}-${String(Date.now())}-${Math.random().toString(16).slice(2)}`)
}

function writeManifest(rootPath: string, manifest: Record<string, unknown>): void {
  mkdirSync(rootPath, { recursive: true })
  writeFileSync(join(rootPath, HARNESS_EXTENSION_MANIFEST_FILENAME), JSON.stringify(manifest, null, 2))
}

describe('ExtensionDiscovery', () => {
  it('loads one extension package with resolved manifest and main paths', () => {
    const root = fixtureDir('single')
    writeManifest(root, {
      id: '@telegraph/demo',
      displayName: 'Demo',
      version: '0.1.0',
      main: './src/activate.ts',
    })

    const pkg = loadHarnessExtensionPackageSync(root, 'builtin')

    expect(pkg).toMatchObject({
      manifest: {
        id: '@telegraph/demo',
      },
      rootPath: root,
      manifestPath: join(root, HARNESS_EXTENSION_MANIFEST_FILENAME),
      mainPath: join(root, 'src', 'activate.ts'),
      sourceKind: 'builtin',
    })
    expect(resolveHarnessExtensionManifestPath(root)).toBe(join(root, HARNESS_EXTENSION_MANIFEST_FILENAME))
  })

  it('discovers extension roots from a directory without treating bad packages as fatal', async () => {
    const root = fixtureDir('scan')
    const extensionsDir = join(root, 'extensions')
    const goodRoot = join(extensionsDir, 'good')
    const badRoot = join(extensionsDir, 'bad')
    mkdirSync(extensionsDir, { recursive: true })
    writeManifest(goodRoot, {
      id: '@telegraph/good',
      displayName: 'Good',
      version: '0.1.0',
      contributes: {
        resources: [
          {
            id: 'reviewer',
            kind: 'skill',
            path: './skills/reviewer/SKILL.md',
          },
        ],
      },
    })
    writeManifest(badRoot, {
      id: '@telegraph/bad',
      version: '0.1.0',
    })

    const discovered = discoverHarnessExtensionSourcesFromDirsSync([
      { dirPath: extensionsDir, sourceKind: 'user' },
    ])
    const loadedSync = loadHarnessExtensionPackagesFromDirsSync([
      { dirPath: extensionsDir, sourceKind: 'user' },
    ])
    const loadedAsync = await loadHarnessExtensionPackagesFromDirs([
      { dirPath: extensionsDir, sourceKind: 'user' },
    ])

    expect(discovered.sources.map(source => source.rootPath)).toEqual([badRoot, goodRoot])
    expect(loadedSync.packages.map(pkg => pkg.manifest.id)).toEqual(['@telegraph/good'])
    expect(loadedAsync.packages.map(pkg => pkg.manifest.id)).toEqual(['@telegraph/good'])
    expect(loadedSync.diagnostics).toEqual([
      expect.objectContaining({
        code: 'manifest_parse_failed',
        path: join(badRoot, HARNESS_EXTENSION_MANIFEST_FILENAME),
      }),
    ])
  })
})
