/**
 * Build a thin forwarding proxy over a possibly-not-yet-ready RPC
 * client.
 *
 * Pagelet workers like ConnectionWorker / SettingWorker register
 * service handlers at construction time, but the underlying
 * shared/daemon channels are populated asynchronously during
 * `PageletWorker.boot()` — and may stay null while the peer
 * supervisor is restarting after a crash. Without this helper every
 * forwarding handler has to write
 *
 *   callSharedEcho: (msg) =>
 *     this.sharedClient?.echo(msg) ?? Promise.resolve('shared not ready')
 *
 * which:
 *   - Repeats the fallback string per call site (6+ in each worker)
 *   - Forces every renderer-facing method to remember the null check
 *   - Gives no central place to add a timeout / circuit breaker later
 *     when D-007 G2 (CircuitBreaker into RPC stack) lands upstream
 *
 * The proxy returned here is type-equivalent to `T` (the RPC service
 * interface) so call sites stay
 *
 *   callSharedEcho: (msg) => shared.echo(msg)
 *
 * and any unavailability is handled centrally. The caller passes a
 * **getter** (not the value) because the underlying client reference
 * is replaced post-boot when `clientHost.registerClient` resolves.
 *
 * @param getClient   Closure returning the latest client reference
 *                    (null/undefined when the peer isn't ready yet).
 * @param peerLabel   Human-readable peer name used in the fallback
 *                    payload, e.g. 'shared', 'daemon', 'main'.
 * @returns A proxy of type T whose every method either forwards to
 *          the live client or resolves to `'${peerLabel} not ready'`.
 *
 * @remarks
 * - Only RPC-style methods returning Promise are sensible targets. The
 *   fallback resolves with a string so the renderer sees a value, not
 *   a rejection (matches the original hand-rolled fallback semantics).
 * - This is intentionally **not** a circuit breaker: there is no
 *   per-call timeout and no failure tracking. Once x-oasis exposes
 *   CircuitBreaker.wrap on the RPC client (see D-007 G2 and
 *   discussion 20260514-circuit-breaker-dead-code in red/x-oasis), the
 *   bulk of "not ready" cases collapse into circuit-open responses
 *   and this helper degrades to "is the channel even bound yet".
 */
export function createForwardingProxy<T extends object>(
  getClient: () => T | null | undefined,
  peerLabel: string
): T {
  const fallback = (): Promise<string> =>
    Promise.resolve(`${peerLabel} not ready`);

  return new Proxy({} as T, {
    get(_target, prop) {
      // Forward symbol access (Symbol.toPrimitive, .then etc.) untouched
      // to keep `await proxy` and console.log behaviour sane. A null
      // client + symbol access just yields undefined.
      if (typeof prop === 'symbol') {
        const client = getClient();
        return client ? Reflect.get(client, prop) : undefined;
      }

      return (...args: unknown[]): unknown => {
        const client = getClient();
        if (!client) return fallback();
        const fn = (client as Record<string, unknown>)[prop];
        if (typeof fn !== 'function') return fallback();
        return (fn as (...a: unknown[]) => unknown).apply(client, args);
      };
    },
  });
}
