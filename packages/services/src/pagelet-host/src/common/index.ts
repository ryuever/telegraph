export const RENDERER_PARTICIPANT_ID = 'renderer';

export const CONNECTION_PARTICIPANT_ID = 'connection';

export const MONITOR_PARTICIPANT_ID = 'monitor';

export const SETTING_PARTICIPANT_ID = 'setting';

export const MAIN_RPC_SERVICE_PATH = 'main-rpc';

export interface IMainRpcService {
  mainPing(msg: string): Promise<string>;
}
