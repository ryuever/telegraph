import { resolve } from 'node:path'
import {
  ComputerUseBroker,
  FileObservationArtifactStore,
  MacOsScreenCaptureObservationProvider,
} from '@/packages/computer-use'
import type {
  AgentEvent,
  RuntimeSettings,
  RuntimeTaskCapabilityProfile,
} from '@/packages/agent-protocol'
import type {
  AgentCapability,
  FeedbackAPI,
} from '@/packages/agent/harness/CapabilityHost'
import {
  codingCapabilities,
  type TaskCapabilityProfile,
} from '@/packages/agent/harness'
import {
  PermissionBroker,
  type PageletKind,
  type PermissionBrokerRequestContext,
  type PermissionPromptHandler,
  type WorkspacePermissionPolicy,
} from '@/packages/agent/harness/PermissionBroker'
import {
  PermissionedNodeFilesystemCapability,
  PermissionedNodePatchCapability,
  PermissionedNodeProcessCapability,
} from './NodeIntegrationCapabilities'
import { ComputerUseActionTool } from './ComputerUseActionCapability'
import { ComputerUseObservationTool } from './ComputerUseObservationCapability'

export interface PageletRunCapabilityOptions {
  runId: string
  sessionId?: string
  pageletId: string
  pageletKind: PageletKind
  settings: RuntimeSettings
  feedback?: FeedbackAPI
  emit?: (event: AgentEvent, context: PermissionBrokerRequestContext) => void | Promise<void>
  prompt?: PermissionPromptHandler
  workspaceRoot?: string
  allowedEnvKeys?: string[]
  computerUseBroker?: ComputerUseBroker
}

export function createPageletRunCapabilities(options: PageletRunCapabilityOptions): AgentCapability[] {
  const taskProfile = options.settings.taskCapabilityProfile ?? { kind: 'default' }
  const context = createPermissionContext(options, taskProfile)
  const broker = new PermissionBroker({
    emit: options.emit,
    prompt: options.prompt ?? (() => false),
  })
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd())

  const processCapability = shouldAttachProcess(taskProfile)
    ? new PermissionedNodeProcessCapability({
        broker,
        context,
        emit: options.emit,
        allowedCwdRoots: [workspaceRoot],
        allowedEnvKeys: options.allowedEnvKeys,
      })
    : undefined
  const filesystemCapability = shouldAttachFilesystem(taskProfile)
    ? new PermissionedNodeFilesystemCapability({
        broker,
        context,
        emit: options.emit,
        allowedRoots: [workspaceRoot],
      })
    : undefined
  const patchCapability = shouldAttachPatch(taskProfile)
    ? new PermissionedNodePatchCapability({
        broker,
        context,
        emit: options.emit,
        allowedRoots: [workspaceRoot],
      })
    : undefined
  const computerUseScopes = taskProfile.kind === 'computer-observe' || taskProfile.kind === 'computer-act'
    ? taskProfile.scopes
    : undefined
  const computerUseBroker = options.computerUseBroker ?? createDefaultComputerUseBroker()
  const computerObserveTool = shouldAttachComputerObserve(taskProfile)
    ? new ComputerUseObservationTool({
        runId: options.runId,
        broker: computerUseBroker,
        allowedScopes: computerUseScopes,
      })
    : undefined
  const computerActTool = shouldAttachComputerAct(taskProfile)
    ? new ComputerUseActionTool({
        runId: options.runId,
        broker: computerUseBroker,
        allowedScopes: computerUseScopes,
        allowedActions: taskProfile.kind === 'computer-act' ? taskProfile.actions : undefined,
      })
    : undefined

  const capabilities = codingCapabilities({
    feedback: options.feedback,
    process: processCapability,
    filesystem: filesystemCapability,
    patch: patchCapability,
  })
  if (computerObserveTool) {
    capabilities.push(({ host }) => {
      host.registerTool(computerObserveTool)
    })
  }
  if (computerActTool) {
    capabilities.push(({ host }) => {
      host.registerTool(computerActTool)
    })
  }

  return capabilities
}

function createPermissionContext(
  options: PageletRunCapabilityOptions,
  taskProfile: TaskCapabilityProfile,
): PermissionBrokerRequestContext {
  return {
    runId: options.runId,
    sessionId: options.sessionId,
    pageletId: options.pageletId,
    pageletKind: options.pageletKind,
    taskProfile,
    pageletPolicy: {
      allowedCapabilities: allowedCapabilitiesForProfile(taskProfile),
    },
    workspacePolicy: workspacePolicyForProfile(taskProfile),
  }
}

function shouldAttachProcess(profile: RuntimeTaskCapabilityProfile): boolean {
  return profile.kind === 'shell-automation'
}

function shouldAttachFilesystem(profile: RuntimeTaskCapabilityProfile): boolean {
  return profile.kind === 'readonly-workspace' ||
    profile.kind === 'coding-edit' ||
    profile.kind === 'design-build'
}

function shouldAttachPatch(profile: RuntimeTaskCapabilityProfile): boolean {
  return profile.kind === 'coding-edit' || profile.kind === 'design-build'
}

function shouldAttachComputerObserve(profile: RuntimeTaskCapabilityProfile): boolean {
  return profile.kind === 'computer-observe' || profile.kind === 'computer-act'
}

function shouldAttachComputerAct(profile: RuntimeTaskCapabilityProfile): boolean {
  return profile.kind === 'computer-act'
}

function allowedCapabilitiesForProfile(
  profile: TaskCapabilityProfile,
): Array<'filesystem' | 'shell' | 'network'> {
  switch (profile.kind) {
    case 'readonly-workspace':
      return ['filesystem']
    case 'shell-automation':
      return ['shell']
    case 'coding-edit':
    case 'design-build':
      return ['filesystem']
    case 'computer-observe':
    case 'computer-act':
      return []
    default:
      return []
  }
}

function workspacePolicyForProfile(profile: TaskCapabilityProfile): WorkspacePermissionPolicy {
  if (profile.kind === 'shell-automation') {
    return {
      shell: {
        allowedCommands: profile.commands?.length ? profile.commands : undefined,
        autoGrantUpToRisk: 'low',
        maxRisk: 'medium',
      },
    }
  }

  if (profile.kind === 'readonly-workspace') {
    return {
      filesystem: {
        readableScopes: ['workspace'],
        writableScopes: [],
      },
    }
  }

  if (profile.kind === 'coding-edit' || profile.kind === 'design-build') {
    return {
      filesystem: {
        readableScopes: ['workspace'],
        writableScopes: ['workspace'],
        autoGrantWrites: false,
      },
    }
  }

  return {}
}

function createDefaultComputerUseBroker(): ComputerUseBroker {
  return new ComputerUseBroker(
    new MacOsScreenCaptureObservationProvider(),
    new FileObservationArtifactStore(),
  )
}
