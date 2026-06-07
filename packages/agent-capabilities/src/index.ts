export {
  CapabilityHost,
  type AgentCapability,
  type AgentCapabilityContext,
  type CapabilityHookRegistrar,
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
