import { createId, inject, injectable } from '@x-oasis/di'
import type { LogService } from '@telegraph/services/log/common/log'
import { LogServiceId } from '@telegraph/services/log/common/log'
import type StorageService from '@telegraph/services/storage/node/StorageService'
import { StorageServiceId } from '@telegraph/services/storage/node/StorageService'
import type { IProcessPingClientFactory } from '@telegraph/services/ping/node/ProcessPingClient'
import { ProcessPingClientFactoryId } from '@telegraph/services/ping/node/ProcessPingClient'
import type { Workbench } from '@telegraph/services/workbench/electron-main/Workbench'
import { WorkbenchClient } from '@telegraph/services/workbench/common/config'
import { DiagnosticsId } from '@telegraph/services/diagnostics/node/Diagnostics'
import { servicePath as DiagnosticsServicePath } from '@telegraph/services/diagnostics/common/config'
import type Diagnostics from '@telegraph/services/diagnostics/node/Diagnostics'

import type { ProcessClientChannel } from '@telegraph/services/port-manager/node/ProcessClientChannel'
import { ProcessClientChannelId } from '@telegraph/services/port-manager/node/ProcessClientChannel'

import {
  processName,
  daemonProcessServicePath,
} from '@telegraph/services/process/daemon-process/common/config'
import { RPCServiceHost } from '@x-oasis/async-call-rpc'

import { servicePath as StorageServicePath } from '@telegraph/services/storage/common/config'
import { AssignPassingPortType } from '../../common/types'
import { NodeProcess } from '../../node/NodeProcess'
import AgentStreamService, { AgentStreamServiceId } from '@telegraph/services/agent/node/AgentStreamService'
import { agentStreamServicePath } from '@telegraph/services/agent/common/config'

export const DaemonProcessNodeId = createId('daemon-process')

@injectable()
export default class DaemonProcessNode extends NodeProcess {
  private serviceHost: RPCServiceHost

  constructor(
    @inject(LogServiceId) private logService: LogService,
    @inject(StorageServiceId) private storageService: StorageService,
    @inject(DiagnosticsId) private diagnostics: Diagnostics,
    @inject(WorkbenchClient) protected workbenchClient: Workbench,
    @inject(ProcessClientChannelId) private portManager: ProcessClientChannel,
    @inject(ProcessPingClientFactoryId) private processPingClientFactory: IProcessPingClientFactory,
    @inject(AgentStreamServiceId) private agentStream: AgentStreamService
  ) {
    super('daemon-process', workbenchClient)
    this.serviceHost = new RPCServiceHost()
    this.serviceHost.registerServiceHandler(DiagnosticsServicePath, this.diagnostics)
    this.serviceHost.registerServiceHandler(agentStreamServicePath, this.agentStream)
  }

  start() {
    this.registerServiceHandler()
    this.portManager.initPortChannel({
      id: processName,
      type: AssignPassingPortType.DaemonProcess,
      serviceHost: this.serviceHost,
    })
    this.processPingClientFactory({
      processName: 'daemon-process',
      process,
    })
  }

  registerServiceHandler() {
    this.serviceHost.registerServiceHandler(StorageServicePath, this.storageService)
    this.serviceHost.registerServiceHandler(daemonProcessServicePath, this)
  }
}
