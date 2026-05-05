import type { LlmTracePayload } from './types'

export interface LlmTraceRow {
  sessionId: string
  runId: string
  ts: number
  trace: LlmTracePayload
}

let rows: LlmTraceRow[] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => fn())
}

/** Subscribe for useSyncExternalStore (survives ChatPanel remounts / HMR better than local useState). */
export function subscribeLlmTraceRows(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function getLlmTraceRowsSnapshot(): LlmTraceRow[] {
  return rows
}

export function appendLlmTraceRow(row: LlmTraceRow) {
  rows = [...rows, row]
  emit()
}

/** Removes traces for one sidebar conversation; no-op if sessionId is empty (avoids wiping everything). */
export function clearLlmTraceRowsForSession(sessionId: string) {
  if (!sessionId) return
  rows = rows.filter(r => r.sessionId !== sessionId)
  emit()
}
