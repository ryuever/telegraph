import { createId, inject, injectable } from '@x-oasis/di'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId } from '@app/services/log/common/log'
import type StorageService from '@app/services/storage/node/StorageService'
import { StorageServiceId } from '@app/services/storage/node/StorageService'
import type { IProcessPingClientFactory } from '@app/services/ping/node/ProcessPingClient'
import { ProcessPingClientFactoryId } from '@app/services/ping/node/ProcessPingClient'
import type { Workbench } from '@app/services/workbench/electron-main/Workbench'
import { WorkbenchClient } from '@app/services/workbench/common/config'

import type { ProcessClientChannel } from '@app/services/port-manager/node/ProcessClientChannel'
import { ProcessClientChannelId } from '@app/services/port-manager/node/ProcessClientChannel'

import { NodeProcess } from '@app/services/process/node/NodeProcess'

import {
  processName,
  sharedProcessServicePath,
} from '@app/services/process/shared-process/common/config'

import { servicePath as StorageServicePath } from '@app/services/storage/common/config'

import { RPCServiceHost } from '@x-oasis/async-call-rpc'

import { AssignPassingPortType } from '../../common/types'

export const SharedProcessNodeId = createId('shared-process')

@injectable()
export default class SharedProcessNode extends NodeProcess {
  private serviceHost: RPCServiceHost

  constructor(
    @inject(LogServiceId) protected logService: LogService,
    @inject(StorageServiceId) private storageService: StorageService,
    @inject(ProcessClientChannelId)
    protected portManager: ProcessClientChannel,
    @inject(WorkbenchClient) protected workbenchClient: Workbench,
    @inject(ProcessPingClientFactoryId)
    protected processPingClientFactory: IProcessPingClientFactory
  ) {
    super('shared-process', workbenchClient)

    this.serviceHost = new RPCServiceHost('shared-process')
  }

  start() {
    this.registerServiceHandler()
    this.portManager.initPortChannel({
      id: processName,
      type: AssignPassingPortType.SharedProcess,
      serviceHost: this.serviceHost,
    })
    this.processPingClientFactory({
      processName: 'shared-process',
      process,
    })
  }

  registerServiceHandler() {
    this.serviceHost.registerServiceHandler(StorageServicePath, this.storageService)
    this.serviceHost.registerServiceHandler(sharedProcessServicePath, this)
  }
}
