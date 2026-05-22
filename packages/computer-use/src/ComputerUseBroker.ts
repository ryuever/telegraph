import { randomUUID } from 'node:crypto'
import {
  COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
  type ActionResult,
  type ComputerAction,
  type ComputerActionKind,
  type ComputerTarget,
  type Observation,
  type ObservationKind,
} from '@/packages/computer-use-protocol'
import type { ObservationArtifactStore } from './artifact-store.js'
import {
  UnsupportedComputerActionProvider,
  type ComputerActionProvider,
  type ComputerObservationProvider,
  type ObservationCaptureInput,
  type ObservationPayload,
} from './provider.js'

export interface ComputerUseObserveInput {
  runId?: string
  target: ComputerTarget
  kinds?: ObservationKind[]
  now?: number
}

export interface ComputerUseActInput {
  runId: string
  target: ComputerTarget
  kind: Exclude<ComputerActionKind, 'observe'>
  input?: Record<string, unknown>
  approvalId?: string
  now?: number
}

export interface ComputerUseActionPolicy {
  requireApproval: boolean
  allowedKinds: Array<Exclude<ComputerActionKind, 'observe'>>
  maxActionsPerRun?: number
  captureBeforeAfter?: boolean
  maxObservationAgeMs?: number
  approvalRequiredTargetIds?: string[]
  approvalRequiredAppIds?: string[]
  approvalRequiredWindowIds?: string[]
  approvalRequiredBrowserTabIds?: string[]
}

export interface ComputerUseObservationPolicy {
  deniedTargetIds?: string[]
  deniedAppIds?: string[]
  deniedWindowIds?: string[]
  redactedTargetIds?: string[]
  redactedAppIds?: string[]
  redactedWindowIds?: string[]
}

export class ComputerUseBroker {
  private activeActionId: string | null = null
  private stoppedReason: string | null = null
  private readonly actionCountsByRun = new Map<string, number>()

  constructor(
    private readonly provider: ComputerObservationProvider,
    private readonly artifactStore: ObservationArtifactStore,
    private readonly actionProvider: ComputerActionProvider = new UnsupportedComputerActionProvider(),
    private readonly actionPolicy: ComputerUseActionPolicy = defaultActionPolicy(),
    private readonly observationPolicy: ComputerUseObservationPolicy = {},
  ) {}

  async observe(input: ComputerUseObserveInput): Promise<Observation[]> {
    const kinds = input.kinds ?? ['screenshot']
    const observations: Observation[] = []
    for (const kind of kinds) {
      observations.push(await this.observeKind(input, kind))
    }
    return observations
  }

  async act(input: ComputerUseActInput): Promise<ActionResult> {
    const now = input.now ?? Date.now()
    const action: ComputerAction = {
      actionId: `action-${randomUUID()}`,
      runId: input.runId,
      target: input.target,
      kind: input.kind,
      input: input.input,
      approvalId: input.approvalId,
      requestedAt: now,
      schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
    }

    const rejection = this.validateAction(action, now)
    if (rejection) return rejection

    if (this.activeActionId) {
      return actionFailure(action, 'locked', `Another computer action is active: ${this.activeActionId}`, now)
    }

    this.activeActionId = action.actionId
    try {
      this.recordActionAttempt(action.runId)
      try {
        const beforeObservation = this.actionPolicy.captureBeforeAfter === false
          ? undefined
          : await this.observeKind({
            runId: input.runId,
            target: input.target,
            now,
          }, 'screenshot')
        const result = await this.actionProvider.performAction({
          ...action,
          beforeObservationRef: beforeObservation?.artifactRef,
        })
        const afterObservation = this.actionPolicy.captureBeforeAfter === false
          ? undefined
          : await this.observeKind({
            runId: input.runId,
            target: input.target,
          }, 'screenshot')
        return {
          ...result,
          afterObservationRef: result.afterObservationRef ?? afterObservation?.artifactRef,
        }
      } catch (error) {
        return actionFailure(
          action,
          'unknown',
          error instanceof Error ? error.message : String(error),
          Date.now(),
        )
      }
    } finally {
      this.activeActionId = null
    }
  }

  stopAll(reason = 'Computer use stopped by user.'): void {
    this.stoppedReason = reason
  }

  clearStop(): void {
    this.stoppedReason = null
  }

  getActionCount(runId: string): number {
    return this.actionCountsByRun.get(runId) ?? 0
  }

  private async observeKind(input: ComputerUseObserveInput, kind: ObservationKind): Promise<Observation> {
    const capturedAt = input.now ?? Date.now()
    const policyDecision = evaluateObservationPolicy(input.target, this.observationPolicy)
    if (policyDecision.kind === 'deny') {
      throw new Error(policyDecision.reason)
    }
    const payload = policyDecision.kind === 'redact'
      ? redactedObservationPayload(input.target, kind, policyDecision.reason)
      : await this.capture(input, kind)
    const artifactRef = await this.artifactStore.writeArtifact({
      runId: input.runId,
      kind,
      mediaType: payload.mediaType,
      bytes: payload.bytes,
      title: payload.title,
      now: capturedAt,
    })

    return {
      observationId: `observation-${randomUUID()}`,
      runId: input.runId,
      target: input.target,
      kind,
      artifactRef,
      capturedAt,
      redactions: mergeRedactions(payload.redactions, policyDecision.kind === 'redact' ? [policyDecision.reason] : []),
      schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
    }
  }

  private capture(input: ComputerUseObserveInput, kind: ObservationKind): Promise<ObservationPayload> {
    const captureInput: ObservationCaptureInput = {
      runId: input.runId,
      target: input.target,
    }
    switch (kind) {
      case 'screenshot':
        return this.provider.captureScreenshot(captureInput)
      case 'window_list':
        return this.provider.listWindows(captureInput)
      case 'accessibility_tree':
        if (!this.provider.snapshotAccessibilityTree) throw new Error('Accessibility tree observation is not supported.')
        return this.provider.snapshotAccessibilityTree(captureInput)
      case 'ocr_text':
        if (!this.provider.ocrText) throw new Error('OCR observation is not supported.')
        return this.provider.ocrText(captureInput)
    }
  }

  private validateAction(action: ComputerAction, now: number): ActionResult | null {
    if (this.stoppedReason) {
      return actionFailure(action, 'stopped', this.stoppedReason, now)
    }
    if (!this.actionPolicy.allowedKinds.includes(action.kind as Exclude<ComputerActionKind, 'observe'>)) {
      return actionFailure(action, 'permission_denied', `Computer action "${action.kind}" is not allowed.`, now)
    }
    const approvalRequirement = approvalRequirementForAction(action, this.actionPolicy)
    if (approvalRequirement && !action.approvalId) {
      return actionFailure(action, 'permission_denied', approvalRequirement, now)
    }
    const maxActions = this.actionPolicy.maxActionsPerRun
    if (maxActions !== undefined && this.getActionCount(action.runId) >= maxActions) {
      return actionFailure(action, 'budget_exceeded', `Computer action budget exceeded for run "${action.runId}".`, now)
    }
    const inputRejection = validateActionInput(action, now, this.actionPolicy)
    if (inputRejection) return inputRejection
    return null
  }

  private recordActionAttempt(runId: string): void {
    this.actionCountsByRun.set(runId, this.getActionCount(runId) + 1)
  }
}

function approvalRequirementForAction(
  action: ComputerAction,
  policy: ComputerUseActionPolicy,
): string | null {
  if (policy.requireApproval) return 'Computer action requires approval.'
  const target = action.target
  if (policy.approvalRequiredTargetIds?.includes(target.targetId)) {
    return `Computer action requires approval for target "${target.targetId}".`
  }
  if (target.appId && policy.approvalRequiredAppIds?.includes(target.appId)) {
    return `Computer action requires approval for app "${target.appId}".`
  }
  if (target.windowId && policy.approvalRequiredWindowIds?.includes(target.windowId)) {
    return `Computer action requires approval for window "${target.windowId}".`
  }
  if (target.browserTabId && policy.approvalRequiredBrowserTabIds?.includes(target.browserTabId)) {
    return `Computer action requires approval for browser tab "${target.browserTabId}".`
  }
  return null
}

type ObservationPolicyDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'redact'; reason: string }

function evaluateObservationPolicy(
  target: ComputerTarget,
  policy: ComputerUseObservationPolicy,
): ObservationPolicyDecision {
  if (matchesTargetPolicy(target, {
    targetIds: policy.deniedTargetIds,
    appIds: policy.deniedAppIds,
    windowIds: policy.deniedWindowIds,
  })) {
    return {
      kind: 'deny',
      reason: `Observation denied for target "${target.targetId}".`,
    }
  }
  if (matchesTargetPolicy(target, {
    targetIds: policy.redactedTargetIds,
    appIds: policy.redactedAppIds,
    windowIds: policy.redactedWindowIds,
  })) {
    return {
      kind: 'redact',
      reason: `Observation redacted for target "${target.targetId}".`,
    }
  }
  return { kind: 'allow' }
}

function matchesTargetPolicy(
  target: ComputerTarget,
  policy: { targetIds?: string[]; appIds?: string[]; windowIds?: string[] },
): boolean {
  return Boolean(
    policy.targetIds?.includes(target.targetId) ||
    (target.appId && policy.appIds?.includes(target.appId)) ||
    (target.windowId && policy.windowIds?.includes(target.windowId)),
  )
}

function redactedObservationPayload(
  target: ComputerTarget,
  kind: ObservationKind,
  reason: string,
): ObservationPayload {
  return {
    bytes: new TextEncoder().encode(JSON.stringify({
      target: {
        targetId: target.targetId,
        kind: target.kind,
      },
      kind,
      redacted: true,
      reason,
    }, null, 2)),
    mediaType: 'application/json',
    title: target.label ? `${target.label} (redacted)` : 'Redacted observation',
    redactions: [reason],
  }
}

function mergeRedactions(
  current: string[] | undefined,
  extra: string[],
): string[] | undefined {
  const redactions = [...(current ?? []), ...extra]
  return redactions.length > 0 ? [...new Set(redactions)] : undefined
}

function defaultActionPolicy(): ComputerUseActionPolicy {
  return {
    requireApproval: true,
    allowedKinds: ['click', 'type', 'hotkey', 'scroll', 'wait'],
    maxActionsPerRun: 20,
    captureBeforeAfter: true,
    maxObservationAgeMs: 5_000,
  }
}

function validateActionInput(
  action: ComputerAction,
  now: number,
  policy: ComputerUseActionPolicy,
): ActionResult | null {
  const staleRef = validateObservationFreshness(action, now, policy.maxObservationAgeMs)
  if (staleRef) return staleRef
  if (action.kind === 'click' || action.kind === 'scroll') {
    return validateCoordinates(action, now)
  }
  return null
}

function validateObservationFreshness(
  action: ComputerAction,
  now: number,
  maxObservationAgeMs: number | undefined,
): ActionResult | null {
  if (maxObservationAgeMs === undefined || !action.input) return null
  const capturedAt = numberInput(action.input, 'observationCapturedAt') ??
    (isRecord(action.input.observationRef) ? numberInput(action.input.observationRef, 'capturedAt') : undefined)
  if (capturedAt === undefined) return null
  if (now - capturedAt <= maxObservationAgeMs) return null
  return actionFailure(
    action,
    'stale_ref',
    `Computer action observation reference is stale by ${String(now - capturedAt)}ms.`,
    now,
  )
}

function validateCoordinates(action: ComputerAction, now: number): ActionResult | null {
  const input = action.input
  if (!input) return null
  const point = isRecord(input.point) ? input.point : input
  const x = numberInput(point, 'x')
  const y = numberInput(point, 'y')
  if (x === undefined && y === undefined) return null
  if (x === undefined || y === undefined || !Number.isFinite(x) || !Number.isFinite(y)) {
    return actionFailure(action, 'coordinate_mismatch', 'Computer action coordinates must include finite x and y.', now)
  }

  if (input.coordinateSpace === 'normalized') {
    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) return null
    return actionFailure(action, 'coordinate_mismatch', 'Normalized coordinates must be between 0 and 1.', now)
  }

  const width = numberInput(input, 'viewportWidth')
  const height = numberInput(input, 'viewportHeight')
  if (width !== undefined && height !== undefined && width > 0 && height > 0) {
    if (x >= 0 && x <= width && y >= 0 && y <= height) return null
    return actionFailure(action, 'coordinate_mismatch', 'Pixel coordinates are outside the viewport bounds.', now)
  }

  return actionFailure(
    action,
    'coordinate_mismatch',
    'Computer action coordinates require coordinateSpace="normalized" or viewportWidth/viewportHeight bounds.',
    now,
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function numberInput(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key]
  return typeof value === 'number' ? value : undefined
}

function actionFailure(
  action: ComputerAction,
  failureReason: ActionResult['failureReason'],
  message: string,
  completedAt: number,
): ActionResult {
  return {
    actionId: action.actionId,
    runId: action.runId,
    ok: false,
    completedAt,
    failureReason,
    message,
    schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
  }
}
