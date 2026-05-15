import { createId } from '@x-oasis/di';

import type { SupervisorInspectorSnapshot } from '@/packages/services/main-metrics/common';

export const SHARED_PARTICIPANT_ID = 'shared';

export const SHARED_SERVICE_PATH = 'shared-rpc';

export interface ISharedService {
  echo(msg: string): Promise<string>;
  getConfig(key: string): Promise<string>;
  setConfig(key: string, value: string): Promise<string>;
}

export interface ISharedApplication {
  start(): Promise<void>;
}

export const SharedApplicationId = createId('SharedApplication');

export interface ISharedProcess {
  spawn(): Promise<void>;
  getInspectorSnapshot(): SupervisorInspectorSnapshot | null;
  subscribeStateChange(listener: () => void): () => void;
}

export const SharedProcessId = createId('SharedProcess');
