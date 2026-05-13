export const SHARED_PARTICIPANT_ID = 'shared';

export const SHARED_SERVICE_PATH = 'shared-rpc';

export interface ISharedService {
  echo(msg: string): Promise<string>;
  getConfig(key: string): Promise<string>;
  setConfig(key: string, value: string): Promise<string>;
}
