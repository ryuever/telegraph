export {
  CapabilityHost,
  TelegraphExtensionHostImpl,
  type AgentCapability,
  type AgentCapabilityContext,
  type CapabilityHookRegistrar,
  type CapabilityKind,
  type CommandRegistration,
  type ContextProvider,
  type FeedbackAPI,
  type FilesystemCapability,
  type MessageRenderer,
  type PatchApplyResult,
  type PatchCapability,
  type PatchFileOperation,
  type PatchPreview,
  type ProcessCapability,
  type ProcessExecResult,
  type ProviderRegistration,
  type RuntimeContribution,
  type SubagentProfile,
  type TelegraphExtension,
  type TelegraphExtensionHost,
  type ToolCapability,
} from './CapabilityHost'

export {
  CapabilityBroker,
} from './CapabilityBroker'

export {
  chatCapabilities,
  codingCapabilities,
  designCapabilities,
  feedbackCapability,
} from './capabilities'
