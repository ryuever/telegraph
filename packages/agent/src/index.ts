export {
  DEFAULT_MODEL_CATALOG,
  MINIMAX_PROVIDER_ID,
  MINIMAX_CN_PROVIDER_ID,
  MINIMAX_OPENAI_COMPAT_PROVIDER_ID,
  MINIMAX_OPENAI_BASE_URL,
  createMiniMaxOpenAIModel,
  resolveModel,
} from '@/packages/agent/providers/index'
export type {
  AgentBackendKind,
  AgentOrchestrationMode,
  AgentOrchestrationPattern,
  AgentMessage,
  AgentModel,
  AgentRole,
  AgentRuntimeSettings,
  AgentSendInput,
  AgentStreamCallbacks,
  AgentTextMessage,
  AgentTool,
  ModelDescriptor,
} from '@/packages/agent/types'
export type {
  AgentEvent,
  AgentRunEventEnvelope,
  AgentRunRequest,
  AgentRuntime,
  RunInput,
  RuntimeEvent,
  RuntimeSettings,
  ToolDefinition,
} from '@/packages/agent-protocol'
export { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
export {
  streamPiAiRuntimeEvents,
  TELEGRAPH_PI_AI_PRODUCER_VERSION,
} from '@/packages/agent/runtime/streamPiAiRuntime'
export { jsonSchemaToolToDefinition, piAiToolLikeToDefinition } from '@/packages/agent/runtime/toolAdapters'
export type { RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
export { BaseAgentRuntime } from '@/packages/agent/runtime/AgentRuntime'
export { RunLifecycleManager } from '@/packages/agent/runtime/RunLifecycleManager'
export { PiAiRuntime } from '@/packages/agent/runtime/PiAiRuntime'
export {
  PiEmbeddedRuntime,
  TELEGRAPH_PI_EMBEDDED_PRODUCER_VERSION,
} from '@/packages/agent/runtime/PiEmbeddedRuntime'
export {
  LangGraphRuntime,
  TELEGRAPH_LANGGRAPH_PRODUCER_VERSION,
  createLangGraphRuntime,
  type LangGraphConfig,
} from '@/packages/agent/runtime/LangGraphRuntime'
export {
  TELEGRAPH_ORCHESTRATOR_PRODUCER_VERSION,
  TelegraphOrchestratorRuntime,
  type TelegraphOrchestratorRunner,
  type TelegraphOrchestratorRuntimeOptions,
  type TelegraphOrchestratorSignal,
} from '@/packages/agent/runtime/TelegraphOrchestratorRuntime'
export {
  createDemoOrchestratorRuntime,
  OrchestratorCoreRunner,
  type OrchestratorCoreRunnerOptions,
} from '@/packages/agent/runtime/OrchestratorCoreRunner'
export {
  InMemoryOrchestratorCheckpointController,
  ORCHESTRATOR_CHECKPOINT_METADATA_KEY,
  createOrchestratorCheckpointMetadata,
  readOrchestratorCheckpointMetadata,
  type InMemoryOrchestratorCheckpointControllerOptions,
  type OrchestratorCheckpointControl,
  type OrchestratorCheckpointController,
  type OrchestratorCheckpointMetadata,
  type OrchestratorCheckpointResumeMetadata,
  type OrchestratorPauseInterruptPayload,
  type OrchestratorPauseRequest,
} from '@/packages/agent/runtime/OrchestratorCheckpointController'
export {
  VercelAiRuntime,
  TELEGRAPH_VERCEL_AI_PRODUCER_VERSION,
  createVercelAiRuntime,
  type VercelAiConfig,
} from '@/packages/agent/runtime/VercelAiRuntime'
export {
  createRuntime,
  createPiAiRuntime,
} from '@/packages/agent/runtime/createRuntime'
export {
  RUNTIME_CAPABILITY_DESCRIPTORS,
  RUNTIME_CAPABILITY_KEYS,
  capabilitySupport,
  getRuntimeCapabilityDescriptor,
  listRuntimeCapabilityDescriptors,
  type RuntimeCapabilityDescriptor,
  type RuntimeCapabilityItem,
  type RuntimeCapabilityKey,
  type RuntimeCapabilitySupport,
  type RuntimeMaturity,
  type RuntimeProductLayer,
} from '@/packages/agent/runtime/RuntimeCapabilityDescriptor'
export {
  RuntimeRegistry,
  createAgentHarness,
  isAgentEvent,
  isTerminalAgentEvent,
  selectRuntimeId,
  validateAgentEvent,
  type AgentHarness,
  type AgentHarnessHookHandler,
  type AgentHarnessHooks,
  type AgentHarnessOptions,
  type AgentRunOptions,
  type AgentRuntimeFactory,
  type AgentTraceSink,
  type RuntimeRegistration,
} from '@/packages/agent/harness'
export {
  InMemoryAgentSessionStore,
  type AgentSessionStore,
  type InMemoryAgentSessionStoreOptions,
} from '@/packages/agent/harness'
export {
  CapabilityHost,
  HookBus,
  HookExecutionError,
  InputHookBlockedError,
  chatCapabilities,
  codingCapabilities,
  designCapabilities,
  feedbackCapability,
  type AgentCapability,
  type AgentCapabilityContext,
  type CapabilityKind,
  type FeedbackAPI,
  type FilesystemCapability,
  type PatchApplyResult,
  type PatchCapability,
  type PatchFileOperation,
  type PatchPreview,
  type ProcessCapability,
  type ProcessExecResult,
  type ToolCapability,
} from '@/packages/agent/harness'
export {
  PermissionBroker,
  type FilesystemAccess,
  type FilesystemPermissionPolicy,
  type FilesystemScope,
  type NetworkPermissionPolicy,
  type PageletKind,
  type PageletPermissionPolicy,
  type PermissionBrokerOptions,
  type PermissionBrokerRequestContext,
  type PermissionCapability,
  type PermissionDecision,
  type PermissionDecisionSource,
  type PermissionEventEmitter,
  type PermissionOperation,
  type PermissionPrompt,
  type PermissionPromptHandler,
  type PermissionRisk,
  type PermissionUserIntent,
  type ShellPermissionPolicy,
  type TaskCapabilityProfile,
  type WorkspacePermissionPolicy,
} from '@/packages/agent/harness/PermissionBroker'
export {
  runRuntimeConformance,
  validateRuntimeEventConformance,
  type RuntimeConformanceIssue,
  type RuntimeConformanceReport,
} from '@/packages/agent/runtime/conformance'
export {
  createCheckpointEvent,
  createEdgeTakenEvent,
  createInterruptEvent,
  createNodeCompletedEvent,
  createNodeStartedEvent,
  type CheckpointHookInput,
  type EdgeTakenHookInput,
  type InterruptHookInput,
  type NodeCompletedHookInput,
  type NodeHookInput,
  type OrchestratorHookBase,
} from '@/packages/agent/runtime/observability/orchestratorObservability'
export { Session, type Message, type RunRecord, type ExecutionContext } from '@/packages/agent/runtime/sessionManagement/Session'
export { SessionStore, type SessionStoreConfig } from '@/packages/agent/runtime/sessionManagement/SessionStore'
export { ToolRegistry, type ToolCallEvent, type ToolResultEvent, type ToolParameter, type ToolParameters } from '@/packages/agent/runtime/toolExecution/ToolRegistry'
export { ToolExecutor, type ToolCallInput } from '@/packages/agent/runtime/toolExecution/ToolExecutor'
export { ToolCallParser, type ParsedToolCall } from '@/packages/agent/runtime/toolExecution/ToolCallParser'
// Legacy `extensions/ExtensionManifest` re-exports removed in D-016 P7.
// The orphaned manifest types lived only in the deleted `packages/agent/src/extensions/`
// tree (System A). Current ExtensionManifest contract is owned by
// `@/packages/agent-protocol` (`ExtensionManifest`, `ToolDefinition`) and the
// command-style host lives in `@/packages/agent-extensions`. Import from those
// packages directly — `@telegraph/agent` no longer brokers them.
export { SessionRepository, type StoredSession, type StoredMessage, SessionRepositoryMigration } from '@/packages/agent/persistence/SessionRepository'
export {
  DependencyGraph,
  type ToolDependency,
  type TopoSortResult,
} from '@/packages/agent/runtime/toolCoordination/DependencyGraph'
export {
  RateLimiter,
  type RateLimitConfig,
  type RateLimitResult,
} from '@/packages/agent/runtime/toolCoordination/RateLimiter'
export {
  PermissionValidator,
  type ToolPermissionPolicy,
  type ExecutionContext as PermissionExecutionContext,
  type PermissionCheckResult,
  type PermissionLevel,
} from '@/packages/agent/runtime/toolCoordination/PermissionValidator'
// D-016 P6: the `TELEGRAPH_SUBAGENTS_*` constants and
// `isTelegraphSubagentsSelector` helper used to be re-exported here from the
// now-deleted `@/packages/agent-extension-host` package. They are owned by
// the `@telegraph/subagents` extension itself
// (`@/extensions/telegraph-subagents/src/constants`) — consumers should
// depend on that extension directly rather than reaching through the agent
// kernel.
export {
  DesignBuildDurableSpike,
  InMemoryDurableStepLedger,
  FileDurableStepLedger,
  LedgerBackedDurableRunEngine,
  RestateDurableRunEngine,
  createDurableStepContext,
  durableIdempotencyKey,
  type DesignBuildDurableSpikeArtifact,
  type DesignBuildDurableSpikeExecutors,
  type DesignBuildDurableSpikeInput,
  type DesignBuildDurableSpikeOutput,
  type DesignBuildDurableSpikePatch,
  type DesignBuildDurableSpikePlan,
  type DesignBuildDurableStepId,
  type DurableIdempotencyInput,
  type DurableRunEngine,
  type DurableRunEngineOptions,
  type DurableStepDefinition,
  type DurableStepExecutionContext,
  type DurableStepExecutionResult,
  type DurableStepKind,
  type DurableStepLedger,
  type DurableStepRecord,
  type DurableStepStatus,
  type RestateDurableContext,
  type RestateDurableRunEngineOptions,
} from '@/packages/agent/durable'
export {
  POLICY_PACK_SCHEMA_VERSION,
  REMOTE_AGENT_OS_POLICY_PACK_ID,
  assertPolicyPackValid,
  createPolicyPack,
  createRemoteAgentOsPolicyPack,
  resolvePolicyProfile,
  type PolicyPack,
  type PolicyProfile,
  type RemotePolicyChannelKind,
} from '@/packages/agent/policy'
export {
  CAPABILITY_MARKETPLACE_SCHEMA_VERSION,
  InMemoryCapabilityMarketplace,
  assertCapabilityMarketplaceListingValid,
  createCapabilityMarketplaceListing,
  marketplaceToolKey,
  validateCapabilityMarketplaceListing,
  type CapabilityMarketplaceListing,
  type MarketplaceApprovalMode,
  type MarketplaceApprovalPolicy,
  type MarketplaceCatalogEntry,
  type MarketplaceListingSource,
  type MarketplaceToolDefinition as CapabilityMarketplaceToolDefinition,
  type MarketplaceToolRisk,
  type ResolvedMarketplaceTool,
} from '@/packages/agent/marketplace'
// Legacy `extensions/harness` re-exports removed in D-016 P7.
// The compatibility shim at `packages/agent/src/extensions/harness/index.ts`
// (which itself just forwarded to `@/packages/agent-extensions` + `CapabilityBroker`
// from `@/packages/agent-capabilities`) has been deleted along with the rest of
// `packages/agent/src/extensions/`. Consumers must import these symbols directly
// from `@/packages/agent-extensions` (host, contributions, harness manifest
// loader) or `@/packages/agent-capabilities` (`CapabilityBroker`).
// Repo-wide grep confirmed no external consumer relied on the `@telegraph/agent`
// barrel for any of these names; the only call-sites lived inside the
// `telegraph-subagents` extension and have been migrated to direct imports.
export {
  ExecutionTimeline,
  type TimelineEntry,
  type EventStats,
  type ExecutionMetrics,
} from '@/packages/agent/runtime/observability/ExecutionTimeline'
export {
  MemoryTierManager,
  type MemoryTierConfig,
  type MemoryTier,
  type TieredMessage,
  type MemoryStats,
} from './runtime/memory/MemoryTierManager'
export {
  ConversationArcService,
  type ConversationArc,
  type ArcType,
} from './runtime/memory/ConversationArcService'
export {
  FactValidationEngine,
  type ValidationResult,
  type ValidationSource,
  type ConfidenceLevel,
  type Fact,
} from './runtime/memory/FactValidationEngine'
export {
  SelfHealingValidator,
  type ErrorType,
  type ErrorRecord,
  type LearnedPattern,
} from './runtime/memory/SelfHealingValidator'
export {
  SQLiteMemoryStore,
  type StoredFact,
  type FactValidation,
  type SessionMetadata,
} from './persistence/SQLiteMemoryStore'
export {
  FactRepository,
  type FactSource,
  type FactValidationRecord,
  type FactSearchResult,
} from './persistence/FactRepository'
// Skills module (Node.js-only — import from '@/packages/agent/skills' in Node.js contexts)
export {
  loadSkills,
  loadSkillsFromDir,
  formatSkillsForPrompt,
  type LoadSkillsOptions,
  type LoadSkillsFromDirOptions,
  type Skill,
  type SkillDiagnostic,
  type SkillFrontmatter,
  type LoadSkillsResult,
} from './skills'
export {
  DefaultAgentResourceLoader,
  discoverProjectContextFiles,
  projectResourceContributionsToExtensionPaths,
  resourceExtensionPathsFromContributions,
  type AgentResourceDiagnostic,
  type AgentResourceLoader,
  type AgentResourceSnapshot,
  type AutoMaterializedResourceContributionKind,
  type DefaultAgentResourceLoaderOptions,
  type LoadedContextFile,
  type ResourceContributionPathProjection,
  type ResourceExtensionPaths,
  type ResourcePathEntry,
  type ResourcePathMetadata,
  type ResourceSourceKind,
  type TextResource,
} from '@/packages/agent-resources'
