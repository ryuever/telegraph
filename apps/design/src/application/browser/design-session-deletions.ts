const DESIGN_DELETED_SESSION_IDS_KEY = 'telegraph:design:deletedSessionIds'

export function loadDeletedDesignSessionIds(): string[] {
  try {
    const data = localStorage.getItem(DESIGN_DELETED_SESSION_IDS_KEY)
    if (!data) return []
    const ids = JSON.parse(data) as unknown
    if (!Array.isArray(ids)) return []
    return ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
  } catch {
    return []
  }
}

export function isDesignSessionDeleted(sessionId: string): boolean {
  return loadDeletedDesignSessionIds().includes(sessionId)
}

export function markDesignSessionDeleted(sessionId: string): void {
  try {
    const ids = new Set(loadDeletedDesignSessionIds())
    ids.add(sessionId)
    localStorage.setItem(DESIGN_DELETED_SESSION_IDS_KEY, JSON.stringify([...ids]))
  } catch {
    // Best effort; in-memory deletion still succeeds.
  }
}

export function clearDeletedDesignSession(sessionId: string): void {
  try {
    const ids = loadDeletedDesignSessionIds().filter(id => id !== sessionId)
    localStorage.setItem(DESIGN_DELETED_SESSION_IDS_KEY, JSON.stringify(ids))
  } catch {
    // Best effort; this only affects future ledger hydration.
  }
}
