import {
  CONNECTION_PAGELET_SERVICE_PATH,
  type IConnectionPageletService,
} from '@/apps/connection/application/common';
import { client } from '@/apps/main/application/browser/rpc-clients';

/**
 * Lazy accessor for the connection pagelet's RPC proxy.
 *
 * Calling this materialises the proxy on first invocation only — typically
 * when the user navigates to the connection page and `<PageView/>` mounts.
 * That timing also dodges the spawn-window race that the old eager
 * `getProxy()` in `apps/main/.../rpc-clients.ts` exposed: by the time a
 * human can click into a page, main has long since finished
 * `connectionApp.start()`.
 *
 * Subsequent calls return the same cached proxy (also enforced by
 * `OrchestratorClient.getProxy`'s internal `_serviceProxies` cache).
 *
 * H7 (D-008): one of four per-app lazy getters that replace the central
 * eager registry in `apps/main/browser/rpc-clients.ts`.
 */
let cached: IConnectionPageletService | null = null;

export function getConnectionPageletClient(): IConnectionPageletService {
  if (!cached) {
    cached = client.getProxy(
      CONNECTION_PAGELET_SERVICE_PATH
    ) as unknown as IConnectionPageletService;
  }
  return cached;
}
