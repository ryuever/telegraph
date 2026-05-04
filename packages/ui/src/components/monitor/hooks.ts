import { useEffect, useRef, useState } from 'react'
import { MONITOR_SNAPSHOT_CHANNEL } from '../../../../../apps/telegraph/src/services/monitor/common/config'
import type { MonitorSnapshot } from '../../../../../apps/telegraph/src/services/monitor/common/types'

export function useMonitorSnapshots() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)

  useEffect(() => {
    const bridge = (window as any).telegraph?.ipcRenderer
    if (!bridge?.on) return

    const listener = (_event: unknown, payload: MonitorSnapshot) => {
      setSnapshot(payload)
      setUpdatedAt(Date.now())
    }

    bridge.on(MONITOR_SNAPSHOT_CHANNEL, listener)
    return () => {
      bridge.removeListener?.(MONITOR_SNAPSHOT_CHANNEL, listener)
    }
  }, [])

  return { snapshot, updatedAt }
}

export function useSnapshotHistory(snapshot: MonitorSnapshot | null, limit = 60) {
  const ref = useRef<MonitorSnapshot[]>([])
  const [, setVersion] = useState(0)

  useEffect(() => {
    if (!snapshot) return
    const last = ref.current[ref.current.length - 1]
    if (last && last.timestamp === snapshot.timestamp) return
    const next = ref.current.concat(snapshot)
    if (next.length > limit) next.splice(0, next.length - limit)
    ref.current = next
    setVersion(v => v + 1)
  }, [snapshot, limit])

  return ref.current
}

export function useNowTick(intervalMs = 1000) {
  const [, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
}
