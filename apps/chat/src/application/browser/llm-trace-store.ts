import type { LlmTracePayload } from '@/apps/chat/application/common'

export interface LlmTraceRow {
  sessionId: string
  runId: string
  seq?: number
  ts: number
  trace: LlmTracePayload
}

let rows: LlmTraceRow[] = []
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach(fn => { fn(); })
}

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

export function clearLlmTraceRowsForSession(sessionId: string) {
  if (!sessionId) return
  rows = rows.filter(r => r.sessionId !== sessionId)
  emit()
}
