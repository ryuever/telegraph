// Phase 4 — renderer-side direct-channel client factory.
//
// After the renderer calls `inspector.requestConnect('renderer:main',
// 'pagelet:design')`, main fires `webContents.postMessage(channel, payload,
// [port1])` to deliver the activated MessagePort. x-oasis's
// `registerOrchestratorHandler` listens on the cp channel for this and
// invokes our `onPort` callback with the transferred port.
//
// We then:
//   1. Wrap that port in `RPCMessageChannel`.
//   2. Build a `ProxyRPCClient(servicePath, { channel })` against it.
//   3. Cast the proxy to the typed service contract.
//
// The factory is keyed by `servicePath` so future direct-channel services
// (e.g. a `pagelet:files` participant) reuse the same plumbing.
//
// Idempotency: callers MAY invoke `awaitDirectChannelClient(SAME_PATH)`
// repeatedly; the same promise is returned. The single underlying handler is
// installed lazily on first call and never replaced (x-oasis's
// `registerOrchestratorHandler` calls `service.setChannel`, which would
// clobber a previous registration — installing once avoids that footgun).
import { ProxyRPCClient } from '@x-oasis/async-call-rpc';
import { registerOrchestratorHandler } from '@x-oasis/async-call-rpc-electron/electron-browser';
import { RPCMessageChannel } from '@x-oasis/async-call-rpc-web';

import { getRendererCpChannel } from './RendererCpClient';

interface PendingEntry<T> {
  promise: Promise<T>;
  resolve: (proxy: T) => void;
  reject: (err: Error) => void;
}

const pending = new Map<string, PendingEntry<unknown>>();
let handlerInstalled = false;
let lastServicePath: string | undefined;

/**
 * One-shot subscription that resolves on the *first* activate-connection
 * event from the orchestrator. Returns a typed proxy bound to the freshly
 * activated direct channel.
 *
 * Phase 4 only spawns `pagelet:design`, so the renderer needs exactly one
 * direct channel; calling this twice for the same `servicePath` is a no-op
 * after the first activation (cached promise resolved with the same proxy).
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
  // installed the handler for so we can route the port to its waiter.
  lastServicePath = servicePath;

  installHandlerOnce();

  return promise;
}

function installHandlerOnce(): void {
  if (handlerInstalled) return;
  handlerInstalled = true;

  const cpChannel = getRendererCpChannel();

  try {
    registerOrchestratorHandler(cpChannel, (port: unknown) => {
      // Route to whichever service path is currently awaiting. Phase 4 only
      // one is in-flight at a time; a multi-direct-channel future would
      // include the target servicePath in the activation payload (a small
      // x-oasis extension, tracked separately).
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
        // `createProxy` constrains T extends Record<string, fn>; interfaces
        // don't satisfy that structurally, so cast on the way out (same
        // pattern as inspectorClient.ts).
        const proxy = client.createProxy() as unknown;
        entry.resolve(proxy);
      } catch (err) {
        entry.reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  } catch (err) {
    // Surface install failure to ALL waiting promises, then reset so a future
    // caller can retry once the underlying issue is fixed.
    handlerInstalled = false;
    const error = err instanceof Error ? err : new Error(String(err));
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    throw error;
  }
}

/**
 * Test/diagnostic hook: clear all cached promises and the handler-installed
 * flag. NOT exposed to production code paths.
 */
export function __resetDirectChannelClient(): void {
  pending.clear();
  handlerInstalled = false;
  lastServicePath = undefined;
}
