import { useEffect, useRef, useState } from 'react';
import { monitorPageletClient } from '@telegraph/main/application/browser/rpc-clients';
import { MonitorSnapshot } from '@telegraph/monitor/application/common';

const RETRY_INTERVAL_MS = 2000;

export function useMonitorSnapshots() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);
  const subscribedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const subscribe = async () => {
      if (cancelled || subscribedRef.current) return;
      subscribedRef.current = true;

      try {
        const snap = await monitorPageletClient.getSnapshot();
        if (!cancelled && snap) {
          setSnapshot(snap);
          setUpdatedAt(Date.now());
        }
      } catch {
        subscribedRef.current = false;
        if (!cancelled) {
          retryTimer = setTimeout(subscribe, RETRY_INTERVAL_MS);
        }
        return;
      }

      try {
        if (cancelled) return;
        const result = monitorPageletClient.onPerformanceUpdate(
          (snap: MonitorSnapshot) => {
            if (!cancelled) {
              setSnapshot(snap);
              setUpdatedAt(Date.now());
            }
          }
        );
        const unsub =
          typeof result === 'function'
            ? result
            : result?.unsubscribe
            ? result.unsubscribe.bind(result)
            : () => {};
        if (!cancelled) {
          unsubRef.current = unsub;
        } else {
          unsub();
        }
      } catch {
        subscribedRef.current = false;
        if (!cancelled) {
          retryTimer = setTimeout(subscribe, RETRY_INTERVAL_MS);
        }
      }
    };

    subscribe();

    return () => {
      cancelled = true;
      subscribedRef.current = false;
      if (retryTimer) clearTimeout(retryTimer);
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, []);

  return { snapshot, updatedAt };
}

export function useSnapshotHistory(
  snapshot: MonitorSnapshot | null,
  limit = 60
) {
  const ref = useRef<MonitorSnapshot[]>([]);
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!snapshot) return;
    const last = ref.current[ref.current.length - 1];
    if (last && last.timestamp === snapshot.timestamp) return;
    const next = ref.current.concat(snapshot);
    if (next.length > limit) next.splice(0, next.length - limit);
    ref.current = next;
    setVersion((v) => v + 1);
  }, [snapshot, limit]);

  return ref.current;
}

export function useNowTick(intervalMs = 1000) {
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
