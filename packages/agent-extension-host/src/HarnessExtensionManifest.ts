/**
 * Re-export shim — the canonical module now lives in `@/packages/agent-extensions`.
 *
 * As of D-016 P5 the declarative harness contribution model was migrated to
 * `@telegraph/agent-extensions` so it can sit alongside the new command-style
 * ExtensionHost. This package keeps re-export shims for one release before being
 * removed in D-016 P6.
 */

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
} from '@/packages/agent-extensions'
