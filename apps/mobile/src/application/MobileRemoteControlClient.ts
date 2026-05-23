import type {
  ListChannelRepliesOptions,
  RemoteControlSubmissionResult,
  RemoteControlSubmitOptions,
  SlackDeviceBinding,
  SlackOAuthCallbackInput,
  SlackOAuthCallbackResult,
  SlackTeamAuditEvent,
  SlackUserBinding,
  SlackWorkspaceBinding,
} from '@/apps/remote-control/application/common'
import type { ChannelReply, DeviceBinding, ExternalMessage, RemoteActorSnapshot } from '@/packages/remote-protocol'
import type {
  ApprovalRequestRecord,
  DecideApprovalInput,
  ListApprovalRequestsOptions,
  ListRunProjectionsOptions,
  RunProjectionRecord,
} from '@/packages/run-protocol'
import {
  createMobileDashboardModel,
  type MobileConnectionState,
  type MobileDashboardModel,
} from './MobileDashboardViewModel'
import {
  createMobileSlackGovernanceModel,
  type MobileSlackGovernanceModel,
} from './MobileSlackGovernanceViewModel'

export interface MobileRemoteControlTransport {
  request<Result>(method: string, params?: unknown): Promise<Result>
}

export interface HttpMobileRemoteControlTransportOptions {
  endpoint: string
  headers?: Record<string, string>
  fetch?: typeof fetch
}

export class HttpMobileRemoteControlTransport implements MobileRemoteControlTransport {
  private readonly fetchImpl: typeof fetch

  constructor(private readonly options: HttpMobileRemoteControlTransportOptions) {
    this.fetchImpl = options.fetch ?? fetch
  }

  async request<Result>(method: string, params?: unknown): Promise<Result> {
    const response = await this.fetchImpl(this.options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...this.options.headers,
      },
      body: JSON.stringify({ method, params }),
    })
    const payload = await response.json() as { ok?: boolean; result?: Result; error?: string }
    if (!response.ok || payload.ok === false) {
      throw new Error(payload.error ?? `Remote-control request failed: ${method}`)
    }
    return payload.result as Result
  }
}

export class MobileRemoteControlClient {
  constructor(private readonly transport: MobileRemoteControlTransport) {}

  listDevices(): Promise<DeviceBinding[]> {
    return this.transport.request('listDeviceBindings')
  }

  listRuns(options: ListRunProjectionsOptions = { limit: 50 }): Promise<RunProjectionRecord[]> {
    return this.transport.request('listRunProjections', options)
  }

  listApprovals(options: ListApprovalRequestsOptions = { status: 'pending', limit: 50 }): Promise<ApprovalRequestRecord[]> {
    return this.transport.request('listApprovals', options)
  }

  listReplies(options: ListChannelRepliesOptions = { limit: 50 }): Promise<ChannelReply[]> {
    return this.transport.request('listChannelReplies', options)
  }

  listSlackWorkspaces(): Promise<SlackWorkspaceBinding[]> {
    return this.transport.request('listSlackWorkspaceBindings')
  }

  listSlackUsers(): Promise<SlackUserBinding[]> {
    return this.transport.request('listSlackUserBindings')
  }

  listSlackDevices(): Promise<SlackDeviceBinding[]> {
    return this.transport.request('listSlackDeviceBindings')
  }

  listSlackAuditEvents(): Promise<SlackTeamAuditEvent[]> {
    return this.transport.request('listSlackTeamAuditEvents')
  }

  handleSlackOAuthCallback(input: SlackOAuthCallbackInput): Promise<SlackOAuthCallbackResult> {
    return this.transport.request('handleSlackOAuthCallback', input)
  }

  decideApproval(
    approvalId: string,
    granted: boolean,
    decidedBy: RemoteActorSnapshot,
    reason?: string,
  ): Promise<ApprovalRequestRecord | null> {
    const input: DecideApprovalInput = { granted, decidedBy, reason }
    return this.transport.request('decideApproval', { approvalId, input })
  }

  submitMessage(
    message: ExternalMessage,
    options: RemoteControlSubmitOptions = { requireDeviceBinding: true },
  ): Promise<RemoteControlSubmissionResult> {
    return this.transport.request('submitExternalMessage', { message, options })
  }

  async loadDashboard(input: {
    connection?: MobileConnectionState
    selectedRunId?: string
  } = {}): Promise<MobileDashboardModel> {
    const [devices, runs, approvals, replies] = await Promise.all([
      this.listDevices(),
      this.listRuns(),
      this.listApprovals(),
      this.listReplies(),
    ])
    return createMobileDashboardModel({
      connection: input.connection ?? 'live',
      devices,
      runs,
      approvals,
      replies,
      selectedRunId: input.selectedRunId,
    })
  }

  async loadSlackGovernance(): Promise<MobileSlackGovernanceModel> {
    const [workspaces, users, devices, auditEvents] = await Promise.all([
      this.listSlackWorkspaces(),
      this.listSlackUsers(),
      this.listSlackDevices(),
      this.listSlackAuditEvents(),
    ])
    return createMobileSlackGovernanceModel({
      workspaces,
      users,
      devices,
      auditEvents,
    })
  }

  watchDashboard(input: {
    intervalMs?: number
    selectedRunId?: () => string | undefined
    onUpdate: (model: MobileDashboardModel) => void
    onError?: (error: Error) => void
  }): { unsubscribe(): void } {
    let stopped = false
    const intervalMs = input.intervalMs ?? 5000
    const tick = async (): Promise<void> => {
      try {
        const model = await this.loadDashboard({
          selectedRunId: input.selectedRunId?.(),
          connection: 'live',
        })
        if (!stopped) input.onUpdate(model)
      } catch (error) {
        if (!stopped) input.onError?.(error instanceof Error ? error : new Error(String(error)))
      }
    }
    void tick()
    const timer = setInterval(() => {
      void tick()
    }, intervalMs)
    return {
      unsubscribe: () => {
        stopped = true
        clearInterval(timer)
      },
    }
  }
}
