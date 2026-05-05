/**
 * Monotonic protocol version for {@link RuntimeEvent} and related payloads.
 * Bump only on breaking semantic changes; additive event kinds/fields stay on the same version.
 */
export const RUNTIME_CONTRACT_SCHEMA_VERSION = 1 as const

export type RuntimeContractSchemaVersion = typeof RUNTIME_CONTRACT_SCHEMA_VERSION

/** See A-005 §4.2.1 — used in docs and future registry metadata. */
export type RuntimeCompatibilityLevel = 'supported' | 'best-effort' | 'deprecated' | 'unsupported'
