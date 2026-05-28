import { createId } from '@x-oasis/di';

import type { MonitorSnapshot } from '@/apps/daemon/diagnostics/common/types';
import type { SupervisorInspectorSnapshot } from '@/packages/services/main-metrics/common';

export const DAEMON_PARTICIPANT_ID = 'daemon';

export const DAEMON_SERVICE_PATH = 'daemon-rpc';

export interface IDaemonService {
  echo(msg: string): Promise<string>;
  systemStatus(): Promise<string>;
  getPerformanceSnapshot(): Promise<MonitorSnapshot>;
  onPerformanceUpdate(
    callback: (snapshot: MonitorSnapshot) => void
  ): Promise<() => void>;
}

export type { MonitorSnapshot };

export interface IDaemonProcess {
  spawn(): Promise<void>;
  stop(): void;
  resume(): Promise<void>;
  restart(reason?: string): Promise<void>;
  getInspectorSnapshot(): SupervisorInspectorSnapshot | null;
  subscribeStateChange(listener: () => void): () => void;
}

export const DaemonProcessId = createId('DaemonProcess');

export interface IDaemonApplication {
  start(): Promise<void>;
}

export const DaemonApplicationId = createId('DaemonApplication');
