// Phase 2 — shared constants for the control-plane channel between
// the main process orchestrator and every participant.
//
// `ORCHESTRATOR_CP_CHANNEL_NAME` is the Electron IPC channel name used by
// `IPCMainChannel` (main side) and `IPCRendererChannel` (renderer side).
// Both ends MUST agree on the exact string; that is the only "magic" needed
// to bring up the cp connection. After that, x-oasis takes over.
//
// `ORCHESTRATOR_INSPECTOR_PATH` is the RPC service path under which the
// `OrchestratorInspectorService` is registered on the cp service host. The
// renderer creates a `ProxyRPCClient(ORCHESTRATOR_INSPECTOR_PATH, { channel })`
// to call it — see browser/inspectorClient.ts.

export const ORCHESTRATOR_CP_CHANNEL_NAME = 'telegraph:orchestrator-cp';

export const ORCHESTRATOR_INSPECTOR_PATH = '/services/orchestrator-inspector';

export const ORCHESTRATOR_PROJECT_NAME = 'telegraph';
