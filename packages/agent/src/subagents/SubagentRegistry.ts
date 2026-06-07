/**
 * SubagentRegistry — name → SubagentProfile lookup.
 *
 * Per-pagelet single instance, populated by extensions via
 * `telegraph.registerSubagentProfile(profile)` (wired up in D-016 P3).
 *
 * Intentionally tiny: no priority, no quota, no dependency graph in this PR.
 * Those concerns belong to the Harness (queueing) or extension code (routing).
 */

import type { SubagentProfile } from '@/packages/agent-protocol'

export class SubagentRegistry {
  private readonly profiles = new Map<string, SubagentProfile>()

  register(profile: SubagentProfile): void {
    if (!profile.name) {
      throw new Error('SubagentProfile.name is required')
    }
    if (this.profiles.has(profile.name)) {
      throw new Error(`SubagentProfile "${profile.name}" already registered`)
    }
    this.profiles.set(profile.name, profile)
  }

  /**
   * Replace-or-insert variant. Useful for hot-reload scenarios where an
   * extension re-registers its profiles after a file change.
   */
  upsert(profile: SubagentProfile): void {
    if (!profile.name) {
      throw new Error('SubagentProfile.name is required')
    }
    this.profiles.set(profile.name, profile)
  }

  unregister(name: string): boolean {
    return this.profiles.delete(name)
  }

  get(name: string): SubagentProfile | undefined {
    return this.profiles.get(name)
  }

  has(name: string): boolean {
    return this.profiles.has(name)
  }

  list(): SubagentProfile[] {
    return [...this.profiles.values()]
  }

  size(): number {
    return this.profiles.size
  }

  clear(): void {
    this.profiles.clear()
  }
}
