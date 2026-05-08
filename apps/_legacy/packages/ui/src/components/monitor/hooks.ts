import { useEffect, useRef, useState } from 'react'
import type { MonitorSnapshot } from '../../../../../apps/telegraph/src/services/monitor/common/types'

const MONITOR_SERVICE_PATH = '/services/monitor'

interface MonitorService {
  getSnapshot(): Promise<MonitorSnapshot>
  getMainPid(): Promise<number>
}

export function useMonitorSnapshots() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const serviceRef = useRef<MonitorService | null>(null)

useEffect(() => {
    const createProxy = (): MonitorService | null => {
      // 优先从 window.telegraph 获取，否则从 __telegraphDebug 获取
      const debug = (window as any).__telegraphDebug
      const fn = (window as any).telegraph?.createServiceProxy ?? debug?.createServiceProxy
      if (!fn) {
        console.warn('[useMonitorSnapshots] createServiceProxy not available')
        return null
      }
      
      try {
        return fn('monitor', MONITOR_SERVICE_PATH) as MonitorService
      } catch (err) {
        console.error('[useMonitorSnapshots] Failed to create service proxy:', err)
        return null
      }
    }

    serviceRef.current = createProxy()

    const fetchSnapshot = async () => {
      if (!serviceRef.current) {
        serviceRef.current = createProxy()
      }
      
      try {
        const snap = await serviceRef.current?.getSnapshot()
        if (snap) {
          setSnapshot(snap)
          setUpdatedAt(Date.now())
        }
      } catch (err) {
        console.error('[useMonitorSnapshots] Failed to get snapshot:', err)
      }
    }

    fetchSnapshot()
    const interval = setInterval(fetchSnapshot, 1000)

    return () => clearInterval(interval)
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