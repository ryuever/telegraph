/**
 * Shared constants for Telegraph native subagents.
 * Kept in a separate module so the main barrel can import them
 * without pulling in Node.js-only dependencies (node:fs, node:os, etc.).
 */
export const TELEGRAPH_SUBAGENTS_RUNTIME_ID = 'telegraph-subagents'
export const TELEGRAPH_SUBAGENTS_PRODUCER_VERSION = 'telegraph-subagents@0.1.0'

export function isTelegraphSubagentsSelector(value: unknown): boolean {
  return value === TELEGRAPH_SUBAGENTS_RUNTIME_ID
}
