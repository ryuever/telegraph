import { inject, injectable } from '@x-oasis/di'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId, LogServicePath } from '@app/services/log/common/log'
import type { IProcessPingClientFactory } from '@app/services/ping/node/ProcessPingClient'
import { ProcessPingClientFactoryId } from '@app/services/ping/node/ProcessPingClient'
import type { Workbench } from '@app/services/workbench/electron-main/Workbench'
import { WorkbenchClient } from '@app/services/workbench/common/config'
import type { ProcessClientChannel } from '@app/services/port-manager/node/ProcessClientChannel'
import { ProcessClientChannelId } from '@app/services/port-manager/node/ProcessClientChannel'

import {
  processName,
  pageletProcessServicePath,
} from '@app/services/process/pagelet-process/common/config'
import { RPCServiceHost } from '@x-oasis/async-call-rpc'
import { TELEGRAPH_PROCESS_ID, TELEGRAPH_PROJECT_NAME } from '@app/core/node/process/env'
import { AssignPassingPortType } from '../../common/types'
import { NodeProcess } from '../../node/NodeProcess'

const processId = process.env[TELEGRAPH_PROCESS_ID]!

export const PageletProcessNodeId = 'pagelet-process-node'

@injectable()
export default class PageletProcessNode extends NodeProcess {
  private serviceHost: RPCServiceHost

  projectName: string

  constructor(
    @inject(LogServiceId) private logService: LogService,
    @inject(ProcessClientChannelId)
    private portManager: ProcessClientChannel,
    @inject(WorkbenchClient) protected workbenchClient: Workbench,
    @inject(ProcessPingClientFactoryId) private processPingClientFactory: IProcessPingClientFactory
  ) {
    super(processId, workbenchClient)
    this.projectName = process.env[TELEGRAPH_PROJECT_NAME]!
    this.serviceHost = new RPCServiceHost()
  }

  start() {
    this.registerServiceHandler()

    this.portManager.initPortChannel({
      id: processId,
      type: AssignPassingPortType.PageletProcess,
      serviceHost: this.serviceHost,
    })
    this.portManager.acquireSharedPort()
    this.processPingClientFactory({
      processName,
      process,
    })
  }

  getServiceHost() {
    return this.serviceHost
  }

  registerServiceHandler() {
    this.serviceHost.registerServiceHandler(pageletProcessServicePath, this)
    this.serviceHost.registerServiceHandler(LogServicePath, this.logService)
  }
}
