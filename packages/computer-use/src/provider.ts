import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
  type ActionResult,
  type ComputerAction,
  type ComputerActionKind,
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

export interface MacOsAccessibilityActionProviderOptions {
  execFile?: (file: string, args: string[]) => Promise<void>
  now?: () => number
  wait?: (ms: number) => Promise<void>
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

export class MacOsAccessibilityActionProvider implements ComputerActionProvider {
  constructor(private readonly options: MacOsAccessibilityActionProviderOptions = {}) {}

  async performAction(action: ComputerAction): Promise<ActionResult> {
    try {
      if (action.kind === 'wait') {
        await (this.options.wait ?? defaultWait)(numberInput(action.input, 'ms') ?? 250)
      } else {
        await this.execFile('osascript', ['-e', scriptForAction(action)])
      }
      return {
        actionId: action.actionId,
        runId: action.runId,
        ok: true,
        completedAt: this.now(),
        schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
      }
    } catch (error) {
      return {
        actionId: action.actionId,
        runId: action.runId,
        ok: false,
        completedAt: this.now(),
        failureReason: actionFailureReason(action.kind),
        message: error instanceof Error ? error.message : String(error),
        schemaVersion: COMPUTER_USE_PROTOCOL_SCHEMA_VERSION,
      }
    }
  }

  private execFile(file: string, args: string[]): Promise<void> {
    return (this.options.execFile ?? execFileAsync)(file, args)
  }

  private now(): number {
    return this.options.now?.() ?? Date.now()
  }
}

export function jsonPayload(value: unknown, title?: string): ObservationPayload {
  return {
    bytes: new TextEncoder().encode(JSON.stringify(value, null, 2)),
    mediaType: 'application/json',
    title,
  }
}

function scriptForAction(action: ComputerAction): string {
  switch (action.kind) {
    case 'click': {
      const point = pixelPoint(action)
      return `tell application "System Events" to click at {${String(point.x)}, ${String(point.y)}}`
    }
    case 'type':
      return `tell application "System Events" to keystroke ${appleScriptString(stringInput(action.input, 'text') ?? '')}`
    case 'hotkey': {
      const key = hotkeyInput(action)
      const modifiers = modifierInputs(action)
      const using = modifiers.length > 0
        ? ` using {${modifiers.map(modifier => `${modifier} down`).join(', ')}}`
        : ''
      return `tell application "System Events" to keystroke ${appleScriptString(key)}${using}`
    }
    case 'scroll': {
      const amount = scrollAmount(action)
      const direction = amount < 0 ? 'up' : 'down'
      return `tell application "System Events" to scroll ${direction} by ${String(Math.abs(amount))}`
    }
    default:
      throw new Error(`Unsupported macOS accessibility action: ${action.kind}`)
  }
}

function pixelPoint(action: ComputerAction): { x: number; y: number } {
  const input = action.input
  const point = recordInput(input, 'point') ?? input
  const x = numberInput(point, 'x')
  const y = numberInput(point, 'y')
  if (x === undefined || y === undefined) {
    throw new Error('Computer action coordinates must include x and y.')
  }
  if (stringInput(input, 'coordinateSpace') === 'normalized') {
    const width = numberInput(input, 'viewportWidth')
    const height = numberInput(input, 'viewportHeight')
    if (!width || !height) {
      throw new Error('Normalized macOS action coordinates require viewportWidth and viewportHeight.')
    }
    return {
      x: Math.round(x * width),
      y: Math.round(y * height),
    }
  }
  return {
    x: Math.round(x),
    y: Math.round(y),
  }
}

function hotkeyInput(action: ComputerAction): string {
  const key = stringInput(action.input, 'key') ?? stringArrayInput(action.input, 'keys').at(-1)
  if (!key) throw new Error('Hotkey action requires key or keys input.')
  return key
}

function modifierInputs(action: ComputerAction): string[] {
  const modifiers = stringArrayInput(action.input, 'modifiers')
  const keys = stringArrayInput(action.input, 'keys')
  return normalizeModifiers([...modifiers, ...keys.slice(0, -1)])
}

function normalizeModifiers(values: string[]): string[] {
  const modifiers = new Set<string>()
  for (const value of values) {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'cmd' || normalized === 'command' || normalized === 'meta') modifiers.add('command')
    else if (normalized === 'ctrl' || normalized === 'control') modifiers.add('control')
    else if (normalized === 'alt' || normalized === 'option') modifiers.add('option')
    else if (normalized === 'shift') modifiers.add('shift')
  }
  return Array.from(modifiers)
}

function scrollAmount(action: ComputerAction): number {
  const amount = numberInput(action.input, 'amount') ??
    numberInput(action.input, 'lines') ??
    numberInput(action.input, 'deltaY') ??
    3
  if (amount === 0) throw new Error('Scroll action amount must be non-zero.')
  return Math.trunc(amount)
}

function actionFailureReason(kind: ComputerActionKind): ActionResult['failureReason'] {
  if (kind === 'click' || kind === 'scroll') return 'coordinate_mismatch'
  return 'unknown'
}

function recordInput(input: Record<string, unknown> | undefined, key: string): Record<string, unknown> | undefined {
  const value = input?.[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function numberInput(input: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = input?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function stringInput(input: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = input?.[key]
  return typeof value === 'string' ? value : undefined
}

function stringArrayInput(input: Record<string, unknown> | undefined, key: string): string[] {
  const value = input?.[key]
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function appleScriptString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function defaultWait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

function execFileAsync(file: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, error => {
      if (error) reject(new Error(error.message))
      else resolve()
    })
  })
}
