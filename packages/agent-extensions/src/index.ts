/**
 * `@telegraph/agent-extensions` — the agent extension system package.
 *
 * Hosts two extension models during the D-016 parity window:
 *  - **command-style** (P4): minimal manifest + `export default factory`,
 *    loaded by `ExtensionHost` against a `TelegraphExtensionHost`.
 *  - **declarative harness contributions** (legacy): manifest-driven
 *    contributions resolved through `ContributionRegistry` + snapshot.
 *    Re-exported from `./contribution` for the `@telegraph/subagents`
 *    extension during P5; the old `@/packages/agent-extension-host`
 *    package keeps thin re-export shims and is deleted in P6.
 */

// --- Command-style ExtensionHost (D-016 P4) ---------------------------------

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

// --- Declarative harness contribution model (legacy, D-016 P5 migration) ----

export {
  ActivationHost,
  ContributionRegistry,
  HARNESS_EXTENSION_MANIFEST_FILENAME,
  agentAliasList,
  agentCatalogText,
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
  parseHarnessExtensionManifest,
  resolveHarnessExtensionMainPath,
  resolveHarnessExtensionManifestPath,
  type ActivationEvent,
  type AgentContribution,
  type CommandContribution,
  type ContextProviderContribution,
  type ContributionOrigin,
  type HarnessContributions,
  type HarnessContributionSnapshot,
  type HarnessExtensionActivator,
  type HarnessExtensionContext,
  type HarnessExtensionDirectorySource,
  type HarnessExtensionLoadDiagnostic,
  type HarnessExtensionLoadDiagnosticCode,
  type HarnessExtensionLoadResult,
  type HarnessExtensionLoadSource,
  type HarnessExtensionManifest,
  type HarnessExtensionPackage,
  type HarnessExtensionSourceDiscoveryResult,
  type HarnessExtensionSourceKind,
  type HookContribution,
  type OrchestrationToolContribution,
  type ResolvedAgentContribution,
  type ResolvedContextProviderContribution,
  type ResolvedOrchestrationToolContribution,
  type ResolvedResourceContribution,
  type ResolvedToolContribution,
  type ResourceContribution,
  type ResourceContributionKind,
  type RunnerContribution,
  type ToolContribution,
  type TraceRendererContribution,
} from './contribution'
