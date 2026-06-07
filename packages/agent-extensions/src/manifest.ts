import type { PermissionRequest } from '@/packages/agent-protocol'

/**
 * Minimal extension manifest schema for D-016 P4.
 *
 * Replaces the verbose `HarnessExtensionManifest` (with declarative
 * contributes/activationEvents) — the new model is command-style:
 * the manifest tells the host only how to *find and import* the factory,
 * and the factory itself does all registration imperatively against the
 * TelegraphExtensionHost passed in.
 *
 * See RFC §4 and §7 P4.
 */
export interface ExtensionManifest {
  /** Stable unique id, e.g. `telegraph-subagents`. */
  id: string
  /** Human-readable name. */
  name: string
  /** Semver, free-form for now. */
  version: string
  /** Entry path relative to the extension root (resolved to a file URL for dynamic import). */
  main: string
  /** Permissions the extension declares it needs. Enforcement is the host's job; manifest only declares. */
  permissions?: PermissionRequest[]
  /**
   * Optional dependency hint reserved for future ordering work — not enforced in P4.
   * RFC §8.3 Red Flag #6 keeps the field so we don't have to break the schema later.
   */
  dependsOn?: string[]
  /** Free-form metadata bag. Host treats as opaque. */
  metadata?: Record<string, unknown>
}

/**
 * Parse an unknown JSON value into an ExtensionManifest, throwing with a precise field path on
 * the first violation. Strict by design: a malformed manifest is an error, not a warning.
 */
export function parseExtensionManifest(raw: unknown): ExtensionManifest {
  if (!isRecord(raw)) {
    throw new ExtensionManifestError('extension manifest must be a JSON object')
  }

  assertString(raw, 'id')
  assertString(raw, 'name')
  assertString(raw, 'version')
  assertString(raw, 'main')

  if (raw.permissions !== undefined && !Array.isArray(raw.permissions)) {
    throw new ExtensionManifestError('extension manifest field "permissions" must be an array if provided')
  }
  if (raw.dependsOn !== undefined) {
    if (!Array.isArray(raw.dependsOn)) {
      throw new ExtensionManifestError('extension manifest field "dependsOn" must be an array if provided')
    }
    for (const [index, value] of raw.dependsOn.entries()) {
      if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ExtensionManifestError(`extension manifest field "dependsOn[${String(index)}]" must be a non-empty string`)
      }
    }
  }
  if (raw.metadata !== undefined && !isRecord(raw.metadata)) {
    throw new ExtensionManifestError('extension manifest field "metadata" must be an object if provided')
  }

  return raw as unknown as ExtensionManifest
}

export class ExtensionManifestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtensionManifestError'
  }
}

function assertString(record: Record<string, unknown>, field: string): void {
  const value = record[field]
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ExtensionManifestError(`extension manifest field "${field}" must be a non-empty string`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const EXTENSION_MANIFEST_FILENAME = 'telegraph.extension.json'
