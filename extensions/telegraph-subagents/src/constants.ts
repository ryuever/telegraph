/**
 * Local constants for the @telegraph/subagents extension.
 *
 * These were previously re-exported from `@/packages/agent-extension-host`.
 * As part of D-016 P5, the extension owns its own identity constants so that
 * the agent-extension-host package can be removed in P6 without cross-package
 * coupling.
 */

export const TELEGRAPH_SUBAGENTS_EXTENSION_ID = '@telegraph/subagents'
export const TELEGRAPH_SUBAGENTS_RUNTIME_ID = 'telegraph-subagents'
export const TELEGRAPH_SUBAGENTS_PRODUCER_VERSION = 'telegraph-subagents@0.1.0'

export function isTelegraphSubagentsSelector(value: unknown): boolean {
  return value === TELEGRAPH_SUBAGENTS_RUNTIME_ID
}
