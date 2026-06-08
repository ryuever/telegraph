/**
 * Declarative harness-extension contribution model.
 *
 * Lives alongside the command-style ExtensionHost loader (see `../ExtensionHost.ts`)
 * during the D-016 parity window. The old `@/packages/agent-extension-host` package
 * now re-exports from here and will be removed in D-016 P6.
 */

export {
  ActivationHost,
  type HarnessExtensionActivator,
  type HarnessExtensionContext,
} from './ActivationHost'
export {
  ContributionRegistry,
} from './ContributionRegistry'
export {
  agentAliasList,
  agentCatalogText,
  type ContributionOrigin,
  type HarnessContributionSnapshot,
  type ResolvedAgentContribution,
  type ResolvedContextProviderContribution,
  type ResolvedOrchestrationToolContribution,
  type ResolvedResourceContribution,
  type ResolvedToolContribution,
} from './HarnessContributionSnapshot'
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
} from './ExtensionDiscovery'
export {
  parseHarnessExtensionManifest,
  type ActivationEvent,
  type AgentContribution,
  type CommandContribution,
  type ContextProviderContribution,
  type HarnessContributions,
  type HarnessExtensionManifest,
  type HarnessExtensionPackage,
  type HarnessExtensionSourceKind,
  type HookContribution,
  type OrchestrationToolContribution,
  type ResourceContribution,
  type ResourceContributionKind,
  type RunnerContribution,
  type ToolContribution,
  type TraceRendererContribution,
} from './HarnessExtensionManifest'
