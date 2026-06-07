import type {
  CapabilityHookRegistrar,
  TelegraphExtension,
  TelegraphExtensionHost,
} from '@/packages/agent-capabilities'
import type { ExtensionManifest } from './manifest'

/**
 * On-disk extension package: manifest + resolved paths needed for dynamic import.
 */
export interface ExtensionPackage {
  manifest: ExtensionManifest
  /** Absolute path to the extension root directory. */
  rootPath: string
  /** Absolute path to the manifest file. */
  manifestPath: string
  /** Absolute path to the entry module (resolved from `manifest.main`). */
  mainPath: string
}

/**
 * Lifecycle event payload emitted by ExtensionHost as it activates / deactivates extensions.
 *
 * The host does NOT itself push these onto a RuntimeEvent stream — that's the responsibility
 * of the pagelet wiring that owns the active Run (RFC §4: extension lifecycle is a long-lived
 * pagelet concern, not a per-Run concern). The pagelet bridges these to the runtime event
 * stream by emitting `extension_activated` / `extension_deactivated` RuntimeEvents.
 */
export interface ExtensionLifecycleEvent {
  type: 'activated' | 'deactivated' | 'activation_failed' | 'deactivation_failed'
  extensionId: string
  ts: number
  /** Present on failure events. */
  error?: { message: string; stack?: string }
}

export type ExtensionLifecycleListener = (event: ExtensionLifecycleEvent) => void

/**
 * Active record for a successfully-activated extension. Held until `deactivate(id)` is called.
 */
export interface ActivatedExtension {
  pkg: ExtensionPackage
  /** The factory cleanup fn (if returned). */
  cleanup?: () => void | Promise<void>
  activatedAt: number
}

/**
 * Loader options for ExtensionHost. The host needs:
 *  - the TelegraphExtensionHost instance to hand to factories
 *  - a dynamic-importer (overridable for tests)
 */
export interface ExtensionHostOptions {
  /**
   * The TelegraphExtensionHost instance. Wrapped into the `AgentCapabilityContext.host`
   * passed to each factory.
   */
  telegraph: TelegraphExtensionHost
  /**
   * Hook registrar paired with the host. Wrapped into `AgentCapabilityContext.hooks`.
   * Typically this is the same registrar instance the host was constructed with — but
   * the loader does not assume that and accepts it independently so tests can supply a stub.
   */
  hooks: CapabilityHookRegistrar
  /**
   * Dynamic importer. Defaults to `(specifier) => import(specifier)`. Tests override
   * this to inject in-memory modules without writing files to disk.
   */
  importer?: (specifier: string) => Promise<unknown>
  /** Optional lifecycle listener — pagelet wiring uses this to bridge to RuntimeEvent. */
  onLifecycleEvent?: ExtensionLifecycleListener
  /** Clock injection for deterministic tests. */
  now?: () => number
}

/**
 * Shape of the default export expected from `manifest.main`.
 * RFC §4: `export default (telegraph) => { telegraph.registerTool(...); ... }`
 */
export type ExtensionFactoryModule = {
  default: TelegraphExtension
}
