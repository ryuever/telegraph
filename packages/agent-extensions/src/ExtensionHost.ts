import { pathToFileURL } from 'node:url'
import type {
  AgentCapabilityContext,
  CapabilityHookRegistrar,
  TelegraphExtension,
  TelegraphExtensionHost,
} from '@/packages/agent-capabilities'
import {
  discoverExtensionsInDirectory,
  loadExtensionPackage,
  type DiscoveryDiagnostic,
} from './discovery'
import type {
  ActivatedExtension,
  ExtensionFactoryModule,
  ExtensionHostOptions,
  ExtensionLifecycleEvent,
  ExtensionLifecycleListener,
  ExtensionPackage,
} from './types'

/**
 * D-016 P4 ExtensionHost — the *loader* counterpart to TelegraphExtensionHost (the *API surface*).
 *
 * Responsibilities (strictly limited per RFC §4 / §7 P4):
 *  - Discover extension packages on disk (or accept pre-loaded packages from tests)
 *  - For each package, `await import(main)` and invoke `defaultExport(telegraph)` once
 *  - Capture the optional cleanup fn returned by the factory
 *  - Emit lifecycle events (activated / deactivated / *_failed) to a listener
 *  - On `deactivate(id)` or `deactivateAll()`, call cleanup fns (errors swallowed + logged)
 *
 * Explicitly NOT responsible for:
 *  - Mutating any RuntimeEvent stream directly (pagelet wiring bridges lifecycle events to
 *    `extension_activated` / `extension_deactivated` RuntimeEvents on the active Run)
 *  - Permission enforcement (manifest.permissions is declarative only; CapabilityHost gates)
 *  - Hot-reload / dependency ordering (RFC §8.3 Red Flag #6 — reserved fields, not enforced)
 */
export class ExtensionHost {
  private readonly telegraph: TelegraphExtensionHost
  private readonly hooks: CapabilityHookRegistrar
  private readonly importer: (specifier: string) => Promise<unknown>
  private readonly listener: ExtensionLifecycleListener | undefined
  private readonly now: () => number

  private readonly active = new Map<string, ActivatedExtension>()

  constructor(options: ExtensionHostOptions) {
    this.telegraph = options.telegraph
    this.hooks = options.hooks
    this.importer = options.importer ?? defaultImporter
    this.listener = options.onLifecycleEvent
    this.now = options.now ?? (() => Date.now())
  }

  /** Returns ids of all currently-activated extensions, in activation order. */
  listActivated(): string[] {
    return [...this.active.keys()]
  }

  /** Returns the activation record for an id, or undefined if not active. */
  getActivation(id: string): ActivatedExtension | undefined {
    return this.active.get(id)
  }

  /**
   * Load + activate a single extension from a root directory.
   * Emits `activation_failed` lifecycle event on any discovery / import / factory error.
   * Returns the diagnostics surfaced during discovery (parse failures, missing manifests, etc).
   */
  async activateFromPath(rootPath: string): Promise<{ activated: ActivatedExtension | undefined; diagnostics: DiscoveryDiagnostic[] }> {
    const result = await loadExtensionPackage(rootPath)
    if (result.packages.length === 0) {
      return { activated: undefined, diagnostics: result.diagnostics }
    }
    const pkg = result.packages[0]
    if (pkg === undefined) {
      return { activated: undefined, diagnostics: result.diagnostics }
    }
    const activated = await this.activatePackage(pkg)
    return { activated, diagnostics: result.diagnostics }
  }

  /**
   * Discover and activate every extension under a directory whose children are extension roots.
   * Returns aggregated diagnostics; failed activations also flow through the lifecycle listener.
   */
  async activateFromDirectory(dirPath: string): Promise<{ activated: ActivatedExtension[]; diagnostics: DiscoveryDiagnostic[] }> {
    const result = await discoverExtensionsInDirectory(dirPath)
    const activated: ActivatedExtension[] = []
    for (const pkg of result.packages) {
      const record = await this.activatePackage(pkg)
      if (record) activated.push(record)
    }
    return { activated, diagnostics: result.diagnostics }
  }

  /**
   * Activate a pre-loaded ExtensionPackage. Used by tests that bypass disk discovery, and
   * by callers that want full control over which packages activate (e.g. respecting feature flags).
   *
   * Idempotent: re-activating an already-active id is a no-op that returns the existing record
   * (matches CapabilityHost's dedup-by-id semantics).
   */
  async activatePackage(pkg: ExtensionPackage): Promise<ActivatedExtension | undefined> {
    const existing = this.active.get(pkg.manifest.id)
    if (existing) return existing

    let mod: unknown
    try {
      mod = await this.importer(this.toSpecifier(pkg.mainPath))
    } catch (error) {
      this.emit({ type: 'activation_failed', extensionId: pkg.manifest.id, ts: this.now(), error: toErrorSnapshot(error) })
      return undefined
    }

    const factory = extractFactory(mod)
    if (!factory) {
      this.emit({
        type: 'activation_failed',
        extensionId: pkg.manifest.id,
        ts: this.now(),
        error: { message: `extension "${pkg.manifest.id}" must export a default function (telegraph) => void | cleanup` },
      })
      return undefined
    }

    const context: AgentCapabilityContext = { host: this.telegraph, hooks: this.hooks }
    let factoryResult: ReturnType<TelegraphExtension>
    try {
      factoryResult = factory(context)
    } catch (error) {
      this.emit({ type: 'activation_failed', extensionId: pkg.manifest.id, ts: this.now(), error: toErrorSnapshot(error) })
      return undefined
    }

    let cleanup: (() => void | Promise<void>) | undefined
    try {
      const resolved = await Promise.resolve(factoryResult)
      cleanup = typeof resolved === 'function' ? resolved : undefined
    } catch (error) {
      this.emit({ type: 'activation_failed', extensionId: pkg.manifest.id, ts: this.now(), error: toErrorSnapshot(error) })
      return undefined
    }

    const record: ActivatedExtension = { pkg, cleanup, activatedAt: this.now() }
    this.active.set(pkg.manifest.id, record)
    this.emit({ type: 'activated', extensionId: pkg.manifest.id, ts: record.activatedAt })
    return record
  }

  /**
   * Deactivate a single extension by id. Calls its cleanup fn (if any) and removes it from
   * the active map. Errors from cleanup are reported via `deactivation_failed` and swallowed.
   * No-op if the id isn't active.
   */
  async deactivate(id: string): Promise<void> {
    const record = this.active.get(id)
    if (!record) return
    this.active.delete(id)
    if (!record.cleanup) {
      this.emit({ type: 'deactivated', extensionId: id, ts: this.now() })
      return
    }
    try {
      await Promise.resolve(record.cleanup())
      this.emit({ type: 'deactivated', extensionId: id, ts: this.now() })
    } catch (error) {
      // RFC §8.3 Red Flag #4: cleanup errors are reported but don't block other deactivations.
      this.emit({ type: 'deactivation_failed', extensionId: id, ts: this.now(), error: toErrorSnapshot(error) })
    }
  }

  /** Deactivate every active extension, in reverse activation order. */
  async deactivateAll(): Promise<void> {
    const ids = [...this.active.keys()].reverse()
    for (const id of ids) {
      await this.deactivate(id)
    }
  }

  private emit(event: ExtensionLifecycleEvent): void {
    if (!this.listener) return
    try {
      this.listener(event)
    } catch {
      // listener errors are never allowed to break loader; silent by design (no stderr in libs).
    }
  }

  private toSpecifier(mainPath: string): string {
    // Node ESM dynamic import of an absolute path needs a file:// URL on all platforms.
    return pathToFileURL(mainPath).href
  }
}

function extractFactory(mod: unknown): TelegraphExtension | undefined {
  if (typeof mod === 'function') return mod as TelegraphExtension
  if (mod && typeof mod === 'object' && 'default' in mod) {
    const candidate = (mod as ExtensionFactoryModule).default
    if (typeof candidate === 'function') return candidate
  }
  return undefined
}

async function defaultImporter(specifier: string): Promise<unknown> {
  return import(specifier)
}

function toErrorSnapshot(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, ...(error.stack ? { stack: error.stack } : {}) }
  }
  return { message: typeof error === 'string' ? error : 'unknown error' }
}
