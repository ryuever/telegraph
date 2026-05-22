import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
  type ActionResult,
  type ComputerAction,
  type ComputerTarget,
} from '@/packages/computer-use-protocol'

export interface ObservationCaptureInput {
  runId?: string
  target: ComputerTarget
}

export interface ObservationPayload {
  bytes: Uint8Array
  mediaType: string
  title?: string
  redactions?: string[]
}

export interface ComputerObservationProvider {
  captureScreenshot(input: ObservationCaptureInput): Promise<ObservationPayload>
  listWindows(input: ObservationCaptureInput): Promise<ObservationPayload>
  snapshotAccessibilityTree?(input: ObservationCaptureInput): Promise<ObservationPayload>
  ocrText?(input: ObservationCaptureInput): Promise<ObservationPayload>
}

export interface ComputerActionProvider {
  performAction(action: ComputerAction): Promise<ActionResult>
}

export interface MacOsScreenCaptureObservationProviderOptions {
  execFile?: (file: string, args: string[]) => Promise<void>
  readFile?: (path: string) => Promise<Uint8Array>
  rm?: (path: string) => Promise<void>
  tmpDir?: string
  idFactory?: () => string
}

export class MacOsScreenCaptureObservationProvider implements ComputerObservationProvider {
  constructor(private readonly options: MacOsScreenCaptureObservationProviderOptions = {}) {}

  async captureScreenshot(input: ObservationCaptureInput): Promise<ObservationPayload> {
    const path = join(
      this.options.tmpDir ?? tmpdir(),
      `telegraph-screenshot-${this.options.idFactory?.() ?? randomUUID()}.png`,
    )
    await this.execFile('screencapture', screenshotArgs(input.target, path))
    try {
      const bytes = await (this.options.readFile ?? readFile)(path)
      return {
        bytes,
        mediaType: 'image/png',
        title: input.target.label ?? screenshotTitle(input.target),
      }
    } finally {
      await (this.options.rm
        ? this.options.rm(path)
        : rm(path, { force: true }))
    }
  }

  listWindows(input: ObservationCaptureInput): Promise<ObservationPayload> {
    const payload = {
      target: input.target,
      windows: [],
      capturedAt: Date.now(),
      note: 'Window enumeration provider is not enabled.',
    }
    return Promise.resolve(jsonPayload(payload, input.target.label ?? 'Window list'))
  }

  private execFile(file: string, args: string[]): Promise<void> {
    return (this.options.execFile ?? execFileAsync)(file, args)
  }
}

function screenshotArgs(target: ComputerTarget, path: string): string[] {
  if (target.kind === 'desktop') return ['-x', '-t', 'png', path]
  if ((target.kind === 'window' || target.kind === 'app') && target.windowId) {
    const windowId = normalizedMacOsWindowId(target.windowId)
    if (windowId) return ['-x', '-t', 'png', '-l', windowId, path]
  }
  throw new Error(`Scoped screenshot capture for target kind "${target.kind}" requires a numeric windowId.`)
}

function normalizedMacOsWindowId(windowId: string): string | null {
  return /^\d+$/.test(windowId) ? windowId : null
}

function screenshotTitle(target: ComputerTarget): string {
  if (target.kind === 'desktop') return 'Desktop screenshot'
  if (target.windowId) return `Window ${target.windowId} screenshot`
  return 'Scoped screenshot'
}

export class UnsupportedComputerObservationProvider implements ComputerObservationProvider {
  captureScreenshot(): Promise<ObservationPayload> {
    return Promise.reject(new Error('Screenshot capture is not supported by this provider.'))
  }

  listWindows(input: ObservationCaptureInput): Promise<ObservationPayload> {
    return Promise.resolve(jsonPayload({
      target: input.target,
      windows: [],
      capturedAt: Date.now(),
    }, input.target.label ?? 'Window list'))
  }
}

export class UnsupportedComputerActionProvider implements ComputerActionProvider {
  performAction(action: ComputerAction): Promise<ActionResult> {
    return Promise.resolve({
      actionId: action.actionId,
      runId: action.runId,
      ok: false,
      completedAt: Date.now(),
      failureReason: 'permission_denied',
      message: 'Computer action provider is not enabled.',
      schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
    })
  }
}

export function jsonPayload(value: unknown, title?: string): ObservationPayload {
  return {
    bytes: new TextEncoder().encode(JSON.stringify(value, null, 2)),
    mediaType: 'application/json',
    title,
  }
}

function execFileAsync(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, error => {
      if (error) reject(new Error(error.message))
      else resolve()
    })
  })
}
