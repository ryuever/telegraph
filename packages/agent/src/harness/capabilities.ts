import type {
  AgentCapability,
  FeedbackAPI,
  FilesystemCapability,
  PatchCapability,
  ProcessCapability,
} from './CapabilityHost'

export function feedbackCapability(api: FeedbackAPI): AgentCapability {
  return ({ host }) => {
    host.registerFeedback(api)
  }
}

export function chatCapabilities(options: { feedback?: FeedbackAPI } = {}): AgentCapability[] {
  return options.feedback ? [feedbackCapability(options.feedback)] : []
}

export function designCapabilities(options: { feedback?: FeedbackAPI } = {}): AgentCapability[] {
  return options.feedback ? [feedbackCapability(options.feedback)] : []
}

export function codingCapabilities(options: {
  feedback?: FeedbackAPI
  process?: ProcessCapability
  filesystem?: FilesystemCapability
  patch?: PatchCapability
} = {}): AgentCapability[] {
  const capabilities: AgentCapability[] = []
  if (options.feedback) capabilities.push(feedbackCapability(options.feedback))
  const process = options.process
  if (process) {
    capabilities.push(({ host }) => {
      host.registerProcess(process)
    })
  }
  const filesystem = options.filesystem
  if (filesystem) {
    capabilities.push(({ host }) => {
      host.registerFilesystem(filesystem)
    })
  }
  const patch = options.patch
  if (patch) {
    capabilities.push(({ host }) => {
      host.registerPatch(patch)
    })
  }
  return capabilities
}
