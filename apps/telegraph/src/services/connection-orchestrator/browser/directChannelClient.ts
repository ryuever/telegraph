// Phase 4 — renderer-side direct-channel client factory.
//
// After the renderer calls `inspector.requestConnect('renderer:main',
// 'pagelet:design')`, main fires `webContents.postMessage(channel, payload,
// [port1])` to deliver the activated MessagePort. The renderer cp channel is
// pre-registered (in `RendererCpClient`) with x-oasis's
// `registerOrchestratorHandler` so the `activateConnection` RPC has a handler
// from the moment the channel exists — this avoids a "Method not found" race
// where the very first `requestConnect` fires before any
// `awaitDirectChannelClient` caller has had a chance to install the handler
// lazily (see "race timeline" comment in RendererCpClient.ts).
//
// `awaitDirectChannelClient` here registers a *port consumer* that the
// pre-installed handler dispatches into. The factory:
//   1. Stores a deferred keyed by `servicePath` in the `pending` map.
//   2. The shared orchestrator handler routes the next activated port to it
//      via `dispatchActivatedPort`, builds an `RPCMessageChannel`, wraps it
//      in a `ProxyRPCClient`, and resolves with a typed proxy.
//
// Multi-peer note: Phase 4 only spawns `pagelet:design`, so exactly one port
// is in flight; we use a `lastServicePath` cursor. A multi-direct-channel
// future will pull the target path from the activation payload (tracked in
// D-006 Gap 1).
import { ProxyRPCClient } from '@x-oasis/async-call-rpc';
import { RPCMessageChannel } from '@x-oasis/async-call-rpc-web';

interface PendingEntry<T> {
  promise: Promise<T>;
  resolve: (proxy: T) => void;
  reject: (err: Error) => void;
}

const pending = new Map<string, PendingEntry<unknown>>();
let lastServicePath: string | undefined;

/**
 * One-shot subscription that resolves on the *first* activate-connection
 * event from the orchestrator. Returns a typed proxy bound to the freshly
 * activated direct channel.
 *
 * Phase 4 only spawns `pagelet:design`, so the renderer needs exactly one
 * direct channel; calling this twice for the same `servicePath` returns the
 * same cached promise.
 *
 * Safe to call before *or* after `inspector.requestConnect()` because the
 * underlying orchestrator handler is installed eagerly when the renderer cp
 * channel is created (see `RendererCpClient.getRendererCpChannel`). No
 * lazy-install race window exists.
 *
 * @typeParam T  The service interface, must match what's mounted on the
 *               peer's RPCServiceHost under `servicePath`.
 * @param servicePath  Wire path, e.g. `DESIGN_SERVICE_PATH`.
 */
export function awaitDirectChannelClient<T>(servicePath: string): Promise<T> {
  const cached = pending.get(servicePath);
  if (cached) return cached.promise as Promise<T>;

  let resolve!: (proxy: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  pending.set(servicePath, {
    promise,
    resolve,
    reject,
  } as PendingEntry<unknown>);

  // Phase 4 only one direct channel exists; remember which service path we
  // expect the next activated port to belong to so the shared orchestrator
  // handler can route it to the right waiter.
  lastServicePath = servicePath;

  return promise;
}

/**
 * Called by the orchestrator handler installed in `RendererCpClient`. Wraps
 * the freshly activated `MessagePort` in a direct channel + ProxyRPCClient
 * and resolves the matching pending entry. Exported for that single
 * consumer; treat as package-private.
 */
export function dispatchActivatedPort(port: unknown): void {
  const path = lastServicePath;
  if (!path) return;
  const entry = pending.get(path);
  if (!entry) return;

  try {
    const directChannel = new RPCMessageChannel({
      port: port as MessagePort,
      description: `${path}-direct`,
    });

    const client = new ProxyRPCClient(path, { channel: directChannel });
    // `createProxy` constrains T extends Record<string, fn>; interfaces don't
    // satisfy that structurally, so cast on the way out (same pattern as
    // inspectorClient.ts).
    const proxy = client.createProxy() as unknown;
    entry.resolve(proxy);
  } catch (err) {
    entry.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

/**
 * Test/diagnostic hook: clear all cached promises and the cursor. NOT
 * exposed to production code paths.
 */
export function __resetDirectChannelClient(): void {
  pending.clear();
  lastServicePath = undefined;
}
