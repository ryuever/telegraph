import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost, clientHost } from '@x-oasis/async-call-rpc';
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker';
import { MONITOR_PAGELET_SERVICE_PATH } from '@/apps/monitor/application/common';
import type { SupervisorInspectorSnapshot } from '@/apps/monitor/application/common';
import type {
  IDaemonService,
  MonitorSnapshot,
} from '@/apps/daemon/application/common';
import {
  MAIN_METRICS_SERVICE_PATH,
  type IMainMetricsService,
} from '@/packages/services/main-metrics/common';

export const MonitorPageletWorkerId = createId('MonitorPageletWorker');

type SnapshotCallback = (snapshot: MonitorSnapshot) => void;
type SupervisorSnapshotCallback = (
  snapshots: SupervisorInspectorSnapshot[]
) => void;

@injectable()
export class MonitorPageletWorker extends PageletWorker<unknown, IDaemonService> {
  /**
   * Renderer-supplied performance-update callbacks. We keep our own
   * registry (instead of forwarding straight to daemon) so we can
   * re-subscribe them against the daemon every time the daemon
   * channel reconnects (daemon kill -9 → supervisor respawn → channel
   * `bindPort({rebind:true})` → channel.onDidConnected fires here).
   *
   * Without this, the renderer's one-shot subscription dies with the
   * old daemon process and the SupervisorsPanel daemon card freezes
   * on the old PID.
   */
  private readonly snapshotListeners = new Set<SnapshotCallback>();
  private daemonSubscriptionAttached = false;

  /**
   * Independent push-channel subscribers for supervisor inspector
   * snapshots, sourced from main (not from daemon) — see
   * {@link IMainMetricsService.onSupervisorSnapshotsChanged} for why
   * this lives on a separate path. Same renderer-side fan-out pattern
   * as {@link snapshotListeners}: we register exactly once with main
   * and re-broadcast to every renderer subscriber.
   */
  private readonly supervisorSnapshotListeners =
    new Set<SupervisorSnapshotCallback>();
  private mainMetricsClient: IMainMetricsService | null = null;
  private mainSupervisorSubscriptionAttached = false;
  /** Latest payload from main; replayed to new renderer subscribers. */
  private latestSupervisorSnapshots: SupervisorInspectorSnapshot[] | null = null;

  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }

  override async boot(): Promise<void> {
    await super.boot();
    // Daemon-channel reconnect wiring is delegated to the
    // onDaemonClientReady hook below, which fires whether the initial
    // connect succeeded inside boot() or only later via the late-install
    // recovery path. Main never restarts but its supervisor subscription
    // still rides the same channel — safe to register here directly.
    this.attachMainSupervisorSubscription();
  }

  /**
   * Fires once daemon client is installed (initial boot or late
   * recovery after a connect timeout). Wires reconnect re-subscribe
   * exactly once: the channel object is preserved across
   * `replaceParticipantChannel` so a single onDidConnected handler
   * covers all future daemon supervisor restarts.
   */
  protected override onDaemonClientReady(): void {
    this.attachDaemonReconnectHandler();
  }

  /**
   * Register a single subscription against
   * {@link IMainMetricsService.onSupervisorSnapshotsChanged} (over the
   * pagelet→main channel) and fan out every payload to renderer-side
   * subscribers. Re-subscribes on `mainChannel.onDidConnected` for
   * symmetry with the daemon path; in practice main never restarts but
   * channel-level reconnect semantics are identical.
   */
  private attachMainSupervisorSubscription(): void {
    if (this.mainSupervisorSubscriptionAttached) return;
    if (!this.mainChannel) return;
    this.mainSupervisorSubscriptionAttached = true;

    this.mainMetricsClient = clientHost
      .registerClient(MAIN_METRICS_SERVICE_PATH, { channel: this.mainChannel })
      .createProxy() as unknown as IMainMetricsService;

    const subscribe = (): void => {
      try {
        this.mainMetricsClient?.onSupervisorSnapshotsChanged(
          (snapshots: SupervisorInspectorSnapshot[]) => {
            this.latestSupervisorSnapshots = snapshots;
            for (const cb of this.supervisorSnapshotListeners) {
              try {
                cb(snapshots);
              } catch (err) {
                console.warn(
                  `[monitor-worker] supervisor snapshot listener threw: ${
                    err instanceof Error ? err.message : String(err)
                  }`
                );
              }
            }
          }
        );
      } catch (err) {
        console.warn(
          `[monitor-worker] main supervisor subscribe failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    };

    subscribe();
    this.mainChannel.onDidConnected(() => {
      console.log(
        `[monitor-worker] main channel reconnected — re-subscribing supervisor snapshots`
      );
      subscribe();
    });
  }

  /**
   * Wire `daemonChannel.onDidConnected` so that whenever the daemon
   * channel goes from disconnected → connected (reconnect after a
   * daemon utility-process restart) we re-establish every active
   * `onPerformanceUpdate` subscription. The first connect (initial
   * `boot`) is also covered, but at that point `snapshotListeners` is
   * still empty so it's a no-op — the actual subscriptions happen
   * later when the renderer first calls `onPerformanceUpdate`.
   */
  private attachDaemonReconnectHandler(): void {
    if (this.daemonSubscriptionAttached) return;
    if (!this.daemonChannel) return;
    this.daemonSubscriptionAttached = true;
    this.daemonChannel.onDidConnected(() => {
      if (this.snapshotListeners.size === 0) return;
      console.log(
        `[monitor-worker] daemon channel reconnected — re-subscribing ` +
          `${this.snapshotListeners.size} snapshot listener(s)`
      );
      for (const cb of this.snapshotListeners) {
        try {
          this.daemonClient?.onPerformanceUpdate(cb);
        } catch (err) {
          console.warn(
            `[monitor-worker] re-subscribe failed: ${
              err instanceof Error ? err.message : String(err)
            }`
          );
        }
      }
    });
  }

  protected override onRendererConnection(channel: any): void {
    serviceHost.registerService(MONITOR_PAGELET_SERVICE_PATH, {
      channel,
      serviceHost,
      handlers: {
        info: (): string => `monitor-pagelet ready (pid=${process.pid})`,
        getSnapshot: () => this.daemonClient?.getPerformanceSnapshot(),
        onPerformanceUpdate: (callback: SnapshotCallback) => {
          // Track the callback locally so we can re-subscribe on
          // daemon reconnect. The daemon-side disposer returned by the
          // first subscribe targets the OLD daemon process — after
          // reconnect a fresh subscribe handle is created but we keep
          // returning the original disposer interface to the renderer
          // (the renderer treats it as "stop receiving updates").
          this.snapshotListeners.add(callback);
          this.daemonClient?.onPerformanceUpdate(callback);
          return () => {
            this.snapshotListeners.delete(callback);
            // We intentionally do NOT propagate disposer to daemon —
            // the daemon-side subscriber map is best-effort cleaned
            // when the daemon dies anyway, and after reconnect we
            // would not have a valid disposer for the new subscribe.
            // Renderer-side React effects almost always tear down the
            // whole pagelet so this is fine in practice.
          };
        },
        onSupervisorSnapshotsChanged: (
          callback: SupervisorSnapshotCallback
        ) => {
          this.supervisorSnapshotListeners.add(callback);
          // Replay the latest payload immediately so the renderer
          // doesn't have to wait for the next push to populate. If
          // main hasn't pushed yet, the next event will hit it.
          if (this.latestSupervisorSnapshots !== null) {
            try {
              callback(this.latestSupervisorSnapshots);
            } catch (err) {
              console.warn(
                `[monitor-worker] supervisor replay to new subscriber threw: ${
                  err instanceof Error ? err.message : String(err)
                }`
              );
            }
          }
          return () => {
            this.supervisorSnapshotListeners.delete(callback);
          };
        },
      },
    });
  }
}
