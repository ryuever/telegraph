import {
  MONITOR_PAGELET_SERVICE_PATH,
  type IMonitorPageletService,
} from '@/apps/monitor/application/common';
import { client } from '@/apps/main/application/browser/rpc-clients';

/**
 * Lazy accessor for the monitor pagelet's RPC proxy.
 *
 * See `apps/connection/.../getClient.ts` for the full rationale —
 * H7 (D-008) replaces the central eager registry with per-app lazy
 * getters so the proxy is materialised when the user actually opens
 * the monitor page (well after main finishes spawn + connect for it).
 */
let cached: IMonitorPageletService | null = null;

export function getMonitorPageletClient(): IMonitorPageletService {
  if (!cached) {
    cached = client.getProxy(
      MONITOR_PAGELET_SERVICE_PATH
    ) as unknown as IMonitorPageletService;
  }
  return cached;
}
