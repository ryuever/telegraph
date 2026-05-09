import { useEffect, useRef, useState } from 'react'
import type { MonitorSnapshot } from '@telegraph/services/connection-orchestrator/common/types'

export function useMonitorSnapshots() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchSnapshot = async () => {
      try {
        const snap = await window.telegraph.daemonService.getSnapshot()
        if (!cancelled) {
          setSnapshot(snap)
          setUpdatedAt(Date.now())
        }
      } catch (err) {
        console.error('[useMonitorSnapshots] Failed to get snapshot:', err)
      }
    }

    void fetchSnapshot()
    const interval = setInterval(() => { void fetchSnapshot() }, 5000)

    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return { snapshot, updatedAt }
}

export function useSnapshotHistory(snapshot: MonitorSnapshot | null, limit = 60) {
  const ref = useRef<MonitorSnapshot[]>([])
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (!snapshot) return
    const last = ref.current[ref.current.length - 1] as MonitorSnapshot | undefined
    if (last?.timestamp === snapshot.timestamp) return
    const next = ref.current.concat(snapshot)
    if (next.length > limit) next.splice(0, next.length - limit)
    ref.current = next
    setVersion((v) => v + 1)
  }, [snapshot, limit])

  return ref.current
}

export function useNowTick(intervalMs = 1000) {
  const [, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => { setNow(Date.now()); }, intervalMs)
    return () => { clearInterval(id); }
  }, [intervalMs])
}
