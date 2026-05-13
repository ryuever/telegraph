// Phase 2 — typed renderer-side proxy for the orchestrator inspector.
//
// `ProxyRPCClient.createProxy<T>()` constrains `T extends Record<string,
// (...a: any[]) => any>`. `IOrchestratorInspectorService` is an `interface`,
// which doesn't structurally satisfy that constraint, so we feed createProxy
// a permissive bag and cast on the way out. The cast is local and the public
// surface stays the strict `IOrchestratorInspectorService` shape.
import { ProxyRPCClient } from '@x-oasis/async-call-rpc';

import { ORCHESTRATOR_INSPECTOR_PATH } from '@telegraph/services/connection-orchestrator/common/cp-config';
import type { IOrchestratorInspectorService } from '@telegraph/services/connection-orchestrator/common/types';

import { getRendererCpChannel } from './RendererCpClient';

let cached: IOrchestratorInspectorService | undefined;

export function getInspectorClient(): IOrchestratorInspectorService {
  if (cached) return cached;

  const channel = getRendererCpChannel();
  const client = new ProxyRPCClient(ORCHESTRATOR_INSPECTOR_PATH, { channel });
  // See the file header for why this cast is necessary.
  cached = client.createProxy() as unknown as IOrchestratorInspectorService;
  return cached;
}
