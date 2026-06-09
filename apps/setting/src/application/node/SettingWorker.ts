import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker';
import { ElectronMessagePortMainChannel } from '@x-oasis/async-call-rpc-electron';
import { SETTING_PAGELET_SERVICE_PATH } from '@/apps/setting/application/common';
import type {
  PiAiConnectionTestInput,
  PiAiModelConfigUpsertInput,
  PiAiProviderConfigUpsertInput,
} from '@/apps/setting/application/common';
import type { ISharedService } from '@/apps/shared/application/common';
import type { IDaemonService } from '@/apps/daemon/application/common';
import {
  getPiAiProviderConfig,
  getPiAiRuntimeConfig,
  listPiAiModels,
  listPiAiProviders,
  testPiAiConnection,
  upsertPiAiModelConfig,
  upsertPiAiProviderConfig,
} from './pi-ai-provider-service';

export const SettingWorkerId = createId('SettingWorker');

@injectable()
export class SettingWorker extends PageletWorker<ISharedService, IDaemonService> {
  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }

  protected override onRendererConnection(channel: ElectronMessagePortMainChannel): void {
    serviceHost.registerService(SETTING_PAGELET_SERVICE_PATH, {
      channel,
      serviceHost,
      handlers: {
        info: (): string => `${this.config.selfId} ready (pid=${String(process.pid)})`,
        callSharedEcho: (msg: string): Promise<string> =>
          this.shared.echo(msg),
        callSharedGetConfig: (key: string): Promise<string> =>
          this.shared.getConfig(key),
        callSharedSetConfig: (key: string, value: string): Promise<string> =>
          this.shared.setConfig(key, value),
        callDaemonEcho: (msg: string): Promise<string> =>
          this.daemon.echo(msg),
        callDaemonSystemStatus: (): Promise<string> =>
          this.daemon.systemStatus(),
        callMainPing: (msg: string): Promise<string> => this.main.mainPing(msg),
        listPiAiProviders: () => listPiAiProviders(),
        listPiAiModels: (provider: string) => listPiAiModels(provider),
        testPiAiConnection: (input: PiAiConnectionTestInput) => testPiAiConnection(input),
        getPiAiRuntimeConfig: () => getPiAiRuntimeConfig(),
        upsertPiAiModelConfig: (input: PiAiModelConfigUpsertInput) => upsertPiAiModelConfig(input),
        getPiAiProviderConfig: (provider: string) => getPiAiProviderConfig(provider),
        upsertPiAiProviderConfig: (input: PiAiProviderConfigUpsertInput) => upsertPiAiProviderConfig(input),
      },
    });
  }
}
