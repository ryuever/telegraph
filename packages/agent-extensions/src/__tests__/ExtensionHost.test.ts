import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CapabilityHost,
  type CapabilityHookRegistrar,
  type TelegraphExtension,
  type TelegraphExtensionHost,
} from '@/packages/agent-capabilities'
import { ExtensionHost } from '../ExtensionHost'
import { EXTENSION_MANIFEST_FILENAME, parseExtensionManifest, ExtensionManifestError } from '../manifest'
import type { ExtensionLifecycleEvent, ExtensionPackage } from '../types'

const noopHooks: CapabilityHookRegistrar = { on: () => () => {} }

function makeHost(): TelegraphExtensionHost {
  return new CapabilityHost(noopHooks)
}

function makePkg(overrides: Partial<ExtensionPackage['manifest']> = {}, rootPath = '/virtual/ext'): ExtensionPackage {
  return {
    manifest: {
      id: 'demo',
      name: 'Demo',
      version: '0.0.1',
      main: 'index.js',
      ...overrides,
    },
    rootPath,
    manifestPath: `${rootPath}/${EXTENSION_MANIFEST_FILENAME}`,
    mainPath: `${rootPath}/index.js`,
  }
}

describe('parseExtensionManifest', () => {
  it('accepts a minimal valid manifest', () => {
    const m = parseExtensionManifest({ id: 'a', name: 'A', version: '1.0.0', main: 'index.js' })
    expect(m.id).toBe('a')
    expect(m.permissions).toBeUndefined()
  })

  it('rejects missing required fields with a precise message', () => {
    expect(() => parseExtensionManifest({ name: 'A', version: '1.0.0', main: 'x' })).toThrow(ExtensionManifestError)
    expect(() => parseExtensionManifest({ id: 'a', version: '1.0.0', main: 'x' })).toThrow(/"name"/)
    expect(() => parseExtensionManifest({ id: 'a', name: 'A', main: 'x' })).toThrow(/"version"/)
    expect(() => parseExtensionManifest({ id: 'a', name: 'A', version: '1.0.0' })).toThrow(/"main"/)
  })

  it('rejects non-object input', () => {
    expect(() => parseExtensionManifest('string')).toThrow(ExtensionManifestError)
    expect(() => parseExtensionManifest([])).toThrow(ExtensionManifestError)
    expect(() => parseExtensionManifest(null)).toThrow(ExtensionManifestError)
  })

  it('validates optional dependsOn entries', () => {
    expect(() => parseExtensionManifest({ id: 'a', name: 'A', version: '1.0', main: 'x.js', dependsOn: 'not-array' })).toThrow(/dependsOn/)
    expect(() => parseExtensionManifest({ id: 'a', name: 'A', version: '1.0', main: 'x.js', dependsOn: ['ok', ''] })).toThrow(/dependsOn\[1\]/)
  })

  it('preserves metadata pass-through', () => {
    const m = parseExtensionManifest({ id: 'a', name: 'A', version: '1.0', main: 'x.js', metadata: { foo: 'bar' } })
    expect(m.metadata).toEqual({ foo: 'bar' })
  })
})

describe('ExtensionHost lifecycle (in-memory importer)', () => {
  it('activates a factory, registers tools through the host, and fires activated event', async () => {
    const host = makeHost()
    const events: ExtensionLifecycleEvent[] = []
    const factory: TelegraphExtension = (ctx) => {
      ctx.host.registerTool({
        definition: { name: 'demo.greet', description: 'd', inputSchema: { type: 'object' } },
        execute: async () => ({ ok: true }),
      })
    }
    const ext = new ExtensionHost({
      telegraph: host,
      hooks: noopHooks,
      importer: async () => ({ default: factory }),
      onLifecycleEvent: (e) => events.push(e),
      now: () => 1000,
    })

    const result = await ext.activatePackage(makePkg())
    expect(result?.pkg.manifest.id).toBe('demo')
    expect(ext.listActivated()).toEqual(['demo'])
    expect(host.listTools().map((d) => d.name)).toContain('demo.greet')
    expect(events).toEqual([{ type: 'activated', extensionId: 'demo', ts: 1000 }])
  })

  it('accepts a bare function module (no default wrapper)', async () => {
    const host = makeHost()
    const factory: TelegraphExtension = () => {}
    const ext = new ExtensionHost({ telegraph: host, hooks: noopHooks, importer: async () => factory })
    const record = await ext.activatePackage(makePkg())
    expect(record).toBeDefined()
  })

  it('captures cleanup fn from factory and calls it on deactivate', async () => {
    const host = makeHost()
    const cleanup = vi.fn()
    const factory: TelegraphExtension = () => cleanup
    const events: ExtensionLifecycleEvent[] = []
    const ext = new ExtensionHost({
      telegraph: host,
      hooks: noopHooks,
      importer: async () => ({ default: factory }),
      onLifecycleEvent: (e) => events.push(e),
      now: (() => {
        let t = 100
        return () => (t += 10)
      })(),
    })

    await ext.activatePackage(makePkg())
    await ext.deactivate('demo')

    expect(cleanup).toHaveBeenCalledOnce()
    expect(ext.listActivated()).toEqual([])
    expect(events.map((e) => e.type)).toEqual(['activated', 'deactivated'])
  })

  it('captures async cleanup fn (Promise return)', async () => {
    const host = makeHost()
    const cleanup = vi.fn(async () => {})
    const factory: TelegraphExtension = async () => cleanup
    const ext = new ExtensionHost({ telegraph: host, hooks: noopHooks, importer: async () => ({ default: factory }) })
    await ext.activatePackage(makePkg())
    await ext.deactivate('demo')
    expect(cleanup).toHaveBeenCalledOnce()
  })

  it('emits activation_failed when import throws', async () => {
    const host = makeHost()
    const events: ExtensionLifecycleEvent[] = []
    const ext = new ExtensionHost({
      telegraph: host,
      hooks: noopHooks,
      importer: async () => {
        throw new Error('boom')
      },
      onLifecycleEvent: (e) => events.push(e),
    })
    const record = await ext.activatePackage(makePkg())
    expect(record).toBeUndefined()
    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('activation_failed')
    expect(events[0]?.error?.message).toBe('boom')
  })

  it('emits activation_failed when module has no default export function', async () => {
    const host = makeHost()
    const events: ExtensionLifecycleEvent[] = []
    const ext = new ExtensionHost({
      telegraph: host,
      hooks: noopHooks,
      importer: async () => ({ notDefault: 'wrong' }),
      onLifecycleEvent: (e) => events.push(e),
    })
    await ext.activatePackage(makePkg())
    expect(events[0]?.type).toBe('activation_failed')
    expect(events[0]?.error?.message).toMatch(/must export a default function/)
  })

  it('emits activation_failed when factory throws synchronously', async () => {
    const host = makeHost()
    const events: ExtensionLifecycleEvent[] = []
    const factory: TelegraphExtension = () => {
      throw new Error('factory boom')
    }
    const ext = new ExtensionHost({
      telegraph: host,
      hooks: noopHooks,
      importer: async () => ({ default: factory }),
      onLifecycleEvent: (e) => events.push(e),
    })
    await ext.activatePackage(makePkg())
    expect(events[0]?.type).toBe('activation_failed')
    expect(events[0]?.error?.message).toBe('factory boom')
  })

  it('emits deactivation_failed when cleanup throws and still removes from active list', async () => {
    const host = makeHost()
    const events: ExtensionLifecycleEvent[] = []
    const factory: TelegraphExtension = () => () => {
      throw new Error('cleanup boom')
    }
    const ext = new ExtensionHost({
      telegraph: host,
      hooks: noopHooks,
      importer: async () => ({ default: factory }),
      onLifecycleEvent: (e) => events.push(e),
    })
    await ext.activatePackage(makePkg())
    await ext.deactivate('demo')
    expect(ext.listActivated()).toEqual([])
    expect(events.map((e) => e.type)).toEqual(['activated', 'deactivation_failed'])
  })

  it('deactivate is a no-op for unknown id', async () => {
    const host = makeHost()
    const events: ExtensionLifecycleEvent[] = []
    const ext = new ExtensionHost({ telegraph: host, hooks: noopHooks, onLifecycleEvent: (e) => events.push(e) })
    await ext.deactivate('nope')
    expect(events).toEqual([])
  })

  it('re-activating same id is idempotent and returns existing record', async () => {
    const host = makeHost()
    const factoryFn = vi.fn<TelegraphExtension>(() => {})
    const ext = new ExtensionHost({ telegraph: host, hooks: noopHooks, importer: async () => ({ default: factoryFn }) })
    const first = await ext.activatePackage(makePkg())
    const second = await ext.activatePackage(makePkg())
    expect(first).toBe(second)
    expect(factoryFn).toHaveBeenCalledOnce()
  })

  it('deactivateAll cleans up in reverse activation order', async () => {
    const host = makeHost()
    const order: string[] = []
    const ext = new ExtensionHost({
      telegraph: host,
      hooks: noopHooks,
      importer: async (absolutePath) => {
        const id = absolutePath.includes('/virtual/a/') ? 'a' : 'b'
        const factory: TelegraphExtension = () => () => {
          order.push(id)
        }
        return { default: factory }
      },
    })
    await ext.activatePackage(makePkg({ id: 'a' }, '/virtual/a'))
    await ext.activatePackage(makePkg({ id: 'b' }, '/virtual/b'))
    await ext.deactivateAll()
    expect(order).toEqual(['b', 'a'])
    expect(ext.listActivated()).toEqual([])
  })

  it('listener errors do not propagate', async () => {
    const host = makeHost()
    const factory: TelegraphExtension = () => {}
    const ext = new ExtensionHost({
      telegraph: host,
      hooks: noopHooks,
      importer: async () => ({ default: factory }),
      onLifecycleEvent: () => {
        throw new Error('listener boom')
      },
    })
    await expect(ext.activatePackage(makePkg())).resolves.toBeDefined()
  })
})

describe('ExtensionHost disk-based loading (jiti default importer)', () => {
  let dir = ''

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'telegraph-ext-test-'))
  })

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('activateFromPath loads a TypeScript entry with relative .ts sibling imports and runs the factory', async () => {
    // This is the regression test for the Node 25 type-stripping breakage:
    // chat-worker tried to `import()` an extension's `extension.ts` via raw
    // Node ESM and `from './X'` (no suffix, no .ts suffix) blew up with
    // ERR_MODULE_NOT_FOUND. jiti must resolve the sibling without any
    // suffix gymnastics or tsconfig flags on the extension side.
    const extRoot = join(dir, 'my-ts-ext')
    await mkdir(extRoot, { recursive: true })
    await writeFile(
      join(extRoot, EXTENSION_MANIFEST_FILENAME),
      JSON.stringify({ id: 'my-ts-ext', name: 'My TS Ext', version: '0.1.0', main: 'index.ts' }),
    )
    await writeFile(
      join(extRoot, 'helper.ts'),
      `export const TOOL_NAME: string = 'my.ts.tool'\n`,
    )
    await writeFile(
      join(extRoot, 'index.ts'),
      `import { TOOL_NAME } from './helper'\n` +
        `export default (ctx: any) => {\n` +
        `  ctx.host.registerTool({\n` +
        `    definition: { name: TOOL_NAME, description: 'd', inputSchema: { type: 'object' } },\n` +
        `    execute: async () => ({ ok: true }),\n` +
        `  })\n` +
        `}\n`,
    )

    const host = makeHost()
    const ext = new ExtensionHost({ telegraph: host, hooks: noopHooks })
    const { activated, diagnostics } = await ext.activateFromPath(extRoot)
    expect(diagnostics).toEqual([])
    expect(activated?.pkg.manifest.id).toBe('my-ts-ext')
    expect(host.listTools().map((d) => d.name)).toContain('my.ts.tool')
  })

  it('activateFromPath surfaces parse failure as a diagnostic without throwing', async () => {
    const extRoot = join(dir, 'bad-ext')
    await mkdir(extRoot, { recursive: true })
    await writeFile(join(extRoot, EXTENSION_MANIFEST_FILENAME), '{ not valid json')

    const host = makeHost()
    const ext = new ExtensionHost({ telegraph: host, hooks: noopHooks })
    const { activated, diagnostics } = await ext.activateFromPath(extRoot)
    expect(activated).toBeUndefined()
    expect(diagnostics.some((d) => d.code === 'manifest_parse_failed')).toBe(true)
  })

  it('activateFromDirectory discovers and activates multiple child TypeScript extensions', async () => {
    for (const id of ['ext-a', 'ext-b']) {
      const extRoot = join(dir, id)
      await mkdir(extRoot, { recursive: true })
      await writeFile(
        join(extRoot, EXTENSION_MANIFEST_FILENAME),
        JSON.stringify({ id, name: id, version: '0.0.1', main: 'index.ts' }),
      )
      await writeFile(join(extRoot, 'index.ts'), `export default (): void => {}\n`)
    }
    // Unrelated child without manifest — should be silently skipped.
    await mkdir(join(dir, 'not-an-ext'), { recursive: true })

    const host = makeHost()
    const ext = new ExtensionHost({ telegraph: host, hooks: noopHooks })
    const { activated } = await ext.activateFromDirectory(dir)
    expect(activated.map((r) => r.pkg.manifest.id).sort()).toEqual(['ext-a', 'ext-b'])
  })
})
