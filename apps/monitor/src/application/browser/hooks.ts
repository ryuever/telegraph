import { useEffect, useRef, useState } from 'react';
import { getMonitorPageletClient } from '@/apps/monitor/application/browser/getClient';
import {
  MonitorSnapshot,
  type SupervisorInspectorSnapshot,
} from '@/apps/monitor/application/common';

const RETRY_INTERVAL_MS = 2000;

function createCancelledFlag(): { isCancelled: () => boolean; cancel: () => void } {
  let cancelled = false;
  return {
    isCancelled: () => cancelled,
    cancel: () => { cancelled = true; },
  };
}

export function useMonitorSnapshots(enabled = true) {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) {
      unsubRef.current?.();
      unsubRef.current = null;
      return;
    }

    const { isCancelled, cancel } = createCancelledFlag();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const subscribe = async () => {
      if (isCancelled()) return;

      try {
        const snap = await getMonitorPageletClient().getSnapshot();
        if (!isCancelled()) {
          setSnapshot(snap);
          setUpdatedAt(Date.now());
        }
      } catch {
        if (!isCancelled()) {
          retryTimer = setTimeout(() => { void subscribe(); }, RETRY_INTERVAL_MS);
        }
        return;
      }

      try {
        const result: (() => void) | { unsubscribe: () => void } | undefined =
          getMonitorPageletClient().onPerformanceUpdate(
          (snap: MonitorSnapshot) => {
            if (!isCancelled()) {
              setSnapshot(snap);
              setUpdatedAt(Date.now());
            }
          }
        );
        let unsub: () => void = () => {};
        if (typeof result === 'function') {
          unsub = result;
        } else if (typeof result === 'object') {
          unsub = (result as { unsubscribe: () => void }).unsubscribe.bind(result);
        }
        if (!isCancelled()) {
          unsubRef.current = unsub;
        } else {
          unsub();
        }
      } catch {
        if (!isCancelled()) {
          retryTimer = setTimeout(() => { void subscribe(); }, RETRY_INTERVAL_MS);
        }
      }
    };

    void subscribe();

    return () => {
      cancel();
      if (retryTimer) clearTimeout(retryTimer);
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [enabled]);

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
    const arr = ref.current;
    if (arr.length > 0 && arr[arr.length - 1].timestamp === snapshot.timestamp) return;
    const next = arr.concat(snapshot);
    if (next.length > limit) next.splice(0, next.length - limit);
    ref.current = next;
    setVersion((v) => v + 1);
  }, [snapshot, limit]);

  return ref.current;
}

/**
 * Subscribe to the *independent* supervisor snapshots push channel
 * (sourced from main, not daemon — see
 * `IMonitorPageletService.onSupervisorSnapshotsChanged` for why).
 *
 * Returns `null` until the first payload arrives. Re-subscribes
 * automatically if the underlying RPC subscribe call throws (e.g.
 * pagelet not yet ready) using the same retry cadence as the
 * monitor-snapshot subscription.
 */
export function useSupervisorSnapshots(enabled = true) {
  const [snapshots, setSnapshots] = useState<
    SupervisorInspectorSnapshot[] | null
  >(null);
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!enabled) {
      unsubRef.current?.();
      unsubRef.current = null;
      return;
    }

    const { isCancelled, cancel } = createCancelledFlag();
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    const subscribe = () => {
      if (isCancelled()) return;
      try {
        const result:
          | (() => void)
          | { unsubscribe: () => void }
          | undefined = getMonitorPageletClient().onSupervisorSnapshotsChanged(
          (snaps: SupervisorInspectorSnapshot[]) => {
            if (!isCancelled()) setSnapshots(snaps);
          }
        );
        let unsub: () => void = () => {};
        if (typeof result === 'function') {
          unsub = result;
        } else if (typeof result === 'object') {
          unsub = (
            result as { unsubscribe: () => void }
          ).unsubscribe.bind(result);
        }
        if (!isCancelled()) {
          unsubRef.current = unsub;
        } else {
          unsub();
        }
      } catch {
        if (!isCancelled()) {
          retryTimer = setTimeout(subscribe, RETRY_INTERVAL_MS);
        }
      }
    };

    subscribe();

    return () => {
      cancel();
      if (retryTimer) clearTimeout(retryTimer);
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [enabled]);

  return snapshots;
}

export function useNowTick(intervalMs = 1000, enabled = true) {
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => { setNow(Date.now()); }, intervalMs);
    return () => { clearInterval(id); };
  }, [intervalMs, enabled]);
}
