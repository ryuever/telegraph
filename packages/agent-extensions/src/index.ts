export { ExtensionHost } from './ExtensionHost'

export {
  discoverExtensionsInDirectory,
  loadExtensionPackage,
  type DiscoveryDiagnostic,
  type DiscoveryResult,
} from './discovery'

export {
  EXTENSION_MANIFEST_FILENAME,
  ExtensionManifestError,
  parseExtensionManifest,
  type ExtensionManifest,
} from './manifest'

export type {
  ActivatedExtension,
  ExtensionFactoryModule,
  ExtensionHostOptions,
  ExtensionLifecycleEvent,
  ExtensionLifecycleListener,
  ExtensionPackage,
} from './types'
