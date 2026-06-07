export const TELEGRAPH_SUBAGENTS_EXTENSION_ID = '@telegraph/subagents'
export const TELEGRAPH_SUBAGENTS_RUNTIME_ID = 'telegraph-subagents'
export const TELEGRAPH_SUBAGENTS_PRODUCER_VERSION = 'telegraph-subagents@0.1.0'

export function isTelegraphSubagentsSelector(value: unknown): boolean {
  return value === TELEGRAPH_SUBAGENTS_RUNTIME_ID
}
