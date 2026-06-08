/**
 * Re-export shim — see `./HarnessExtensionManifest.ts` for the migration note (D-016 P5).
 */

export {
  HARNESS_EXTENSION_MANIFEST_FILENAME,
  discoverHarnessExtensionSourcesFromDirs,
  discoverHarnessExtensionSourcesFromDirsSync,
  hasHarnessExtensionManifest,
  hasHarnessExtensionManifestSync,
  loadHarnessExtensionManifest,
  loadHarnessExtensionManifestSync,
  loadHarnessExtensionPackage,
  loadHarnessExtensionPackageSync,
  loadHarnessExtensionPackages,
  loadHarnessExtensionPackagesFromDirs,
  loadHarnessExtensionPackagesFromDirsSync,
  loadHarnessExtensionPackagesSync,
  resolveHarnessExtensionMainPath,
  resolveHarnessExtensionManifestPath,
  type HarnessExtensionDirectorySource,
  type HarnessExtensionLoadDiagnostic,
  type HarnessExtensionLoadDiagnosticCode,
  type HarnessExtensionLoadResult,
  type HarnessExtensionLoadSource,
  type HarnessExtensionSourceDiscoveryResult,
} from '@/packages/agent-extensions'
