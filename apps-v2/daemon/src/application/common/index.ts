export const DAEMON_PARTICIPANT_ID = 'daemon';

export const DAEMON_SERVICE_PATH = 'daemon-rpc';

export interface IDaemonService {
  echo(msg: string): Promise<string>;
  systemStatus(): Promise<string>;
  getPerformanceSnapshot(): Promise<any>;
  onPerformanceUpdate(callback: (snapshot: any) => void): Promise<() => void>;
}
