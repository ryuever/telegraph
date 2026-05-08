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
// ## Race: port arrives before awaitDirectChannelClient is called
//
// The previous design used a `lastServicePath` cursor to route the arriving
// port to the right pending entry. But in typical usage the timing is:
//
//   t0  user clicks Connect → orchestrator delivers port to renderer's
//       activateConnection handler → dispatchActivatedPort(port) fires.
//   t1  user clicks Ping → awaitDirectChannelClient(DESIGN_SERVICE_PATH)
//       is called for the first time.
//
// At t0, `lastServicePath` is still undefined (it's only set by
// `awaitDirectChannelClient`), so the early-return guard in
// `dispatchActivatedPort` drops the port. The Ping promise then hangs forever.
//
// Fix: maintain an `earlyPorts` FIFO queue for ports that arrive before any
// consumer has registered. `awaitDirectChannelClient` drains the queue (FIFO)
// when it is first called. In Phase 4 exactly one port is ever in flight so
// FIFO produces the correct result. A multi-direct-channel future will pull the
// target path from the activation payload (tracked in D-006 Gap 1), at which
// point `earlyPorts` can become a keyed map.
import { ProxyRPCClient } from '@x-oasis/async-call-rpc';
import { RPCMessageChannel } from '@x-oasis/async-call-rpc-web';

interface PendingEntry<T> {
  promise: Promise<T>;
  resolve: (proxy: T) => void;
  reject: (err: Error) => void;
}

const pending = new Map<string, PendingEntry<unknown>>();

/**
 * FIFO queue of ports delivered by the orchestrator before any
 * `awaitDirectChannelClient` caller registered. Drained on the first call to
 * `awaitDirectChannelClient`. Phase 4: at most one element.
 */
const earlyPorts: unknown[] = [];

/**
 * Build and resolve a proxy for `entry` using `port`. Extracted so both the
 * eager path (port arrived first) and the normal path (awaiter registered
 * first) can share the same construction logic.
 */
function resolveEntry(entry: PendingEntry<unknown>, path: string, port: unknown): void {
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
 * One-shot subscription that resolves on the *first* activate-connection
 * event from the orchestrator. Returns a typed proxy bound to the freshly
 * activated direct channel.
 *
 * Phase 4 only spawns `pagelet:design`, so the renderer needs exactly one
 * direct channel; calling this twice for the same `servicePath` returns the
 * same cached promise.
 *
 * Safe to call before *or* after `inspector.requestConnect()` — including
 * after the orchestrator has already delivered the port (the port is drained
 * from `earlyPorts` here immediately). No timing dependency exists.
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

  const entry = { promise, resolve, reject } as unknown as PendingEntry<unknown>;
  pending.set(servicePath, entry);

  // Fast path: the orchestrator already delivered a port (Connect was clicked
  // and resolved before Ping). Drain the first queued port and resolve.
  if (earlyPorts.length > 0) {
    const earlyPort = earlyPorts.shift();
    resolveEntry(entry, servicePath, earlyPort);
  }

  return promise;
}

/**
 * Called by the orchestrator handler installed in `RendererCpClient`. Wraps
 * the freshly activated `MessagePort` in a direct channel + ProxyRPCClient
 * and resolves the matching pending entry. Exported for that single
 * consumer; treat as package-private.
 *
 * If no `awaitDirectChannelClient` caller has registered yet the port is
 * enqueued in `earlyPorts` for later consumption.
 */
export function dispatchActivatedPort(port: unknown): void {
  // Find the first pending entry that hasn't been resolved yet. In Phase 4
  // there is at most one service path (`DESIGN_SERVICE_PATH`).
  for (const [path, entry] of pending.entries()) {
    // An already-resolved entry keeps its promise in the map (for caching), so
    // we can't easily detect "already resolved" here without an extra flag.
    // The RPCMessageChannel constructor below will just fail harmlessly on a
    // re-used port if somehow called twice — but in practice the orchestrator
    // only calls activateConnection once per connection lifetime.
    resolveEntry(entry, path, port);
    return;
  }

  // No consumer registered yet — enqueue for the next awaitDirectChannelClient call.
  earlyPorts.push(port);
}

/**
 * Test/diagnostic hook: clear all cached promises and the early-port queue. NOT
 * exposed to production code paths.
 */
export function __resetDirectChannelClient(): void {
  pending.clear();
  earlyPorts.length = 0;
}
