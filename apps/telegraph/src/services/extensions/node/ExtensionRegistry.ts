import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/**
 * Local extension / deny-list registry (Phase 2–4 baseline).
 * Stored under `~/.telegraph/extension-registry.json` so daemon and future UI can share state.
 */
export interface ExtensionRegistryRecord {
  enabled: boolean
  version?: string
  installPath?: string
}

export interface ExtensionRegistryState {
  schemaVersion: 1
  blocklist: string[]
  extensions: Record<string, ExtensionRegistryRecord>
}

const DEFAULT_STATE: ExtensionRegistryState = {
  schemaVersion: 1,
  blocklist: [],
  extensions: {
    'pi-subagents': { enabled: true, version: 'bundled-or-global' },
  },
}

function registryPath(): string {
  return join(homedir(), '.telegraph', 'extension-registry.json')
}

let singleton: ExtensionRegistry | null = null

export function getExtensionRegistry(): ExtensionRegistry {
  if (!singleton) {
    singleton = ExtensionRegistry.load()
  }
  return singleton
}

export class ExtensionRegistry {
  private constructor(private state: ExtensionRegistryState) {}

  static load(): ExtensionRegistry {
    const path = registryPath()
    try {
      if (!existsSync(path)) {
        return new ExtensionRegistry({ ...DEFAULT_STATE, extensions: { ...DEFAULT_STATE.extensions } })
      }
      const raw = readFileSync(path, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<ExtensionRegistryState>
      const merged: ExtensionRegistryState = {
        schemaVersion: 1,
        blocklist: Array.isArray(parsed.blocklist) ? parsed.blocklist : [],
        extensions:
          parsed.extensions && typeof parsed.extensions === 'object'
            ? { ...DEFAULT_STATE.extensions, ...parsed.extensions }
            : { ...DEFAULT_STATE.extensions },
      }
      return new ExtensionRegistry(merged)
    } catch {
      return new ExtensionRegistry({ ...DEFAULT_STATE, extensions: { ...DEFAULT_STATE.extensions } })
    }
  }

  /** Persist current state (creates parent dir). */
  save(): void {
    const path = registryPath()
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, JSON.stringify(this.state, null, 2), 'utf-8')
  }

  getState(): ExtensionRegistryState {
    return {
      schemaVersion: 1,
      blocklist: [...this.state.blocklist],
      extensions: { ...this.state.extensions },
    }
  }

  fileBlocklist(): string[] {
    return [...this.state.blocklist]
  }

  /** File deny list ∪ per-run client deny list. */
  effectiveBlocklist(client?: string[]): Set<string> {
    const s = new Set(this.state.blocklist)
    for (const id of client ?? []) {
      if (id) s.add(id)
    }
    return s
  }

  setExtensionEnabled(id: string, enabled: boolean): void {
    const prev = this.state.extensions[id] ?? { enabled: true }
    this.state.extensions[id] = { ...prev, enabled }
    this.save()
  }

  addToFileBlocklist(id: string): void {
    if (!this.state.blocklist.includes(id)) {
      this.state.blocklist.push(id)
      this.save()
    }
  }
}
