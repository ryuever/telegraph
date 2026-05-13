export const CONNECTION_PAGELET_SERVICE_PATH = 'pagelet-api';

export interface IConnectionPageletService {
  info(): Promise<string>;
  callSharedEcho(msg: string): Promise<string>;
  callSharedGetConfig(key: string): Promise<string>;
  callSharedSetConfig(key: string, value: string): Promise<string>;
  callDaemonEcho(msg: string): Promise<string>;
  callDaemonSystemStatus(): Promise<string>;
  callMainPing(msg: string): Promise<string>;
}
