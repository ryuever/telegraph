import { Registry } from '@x-oasis/di'
import { LogService, LogServiceId } from '@app/services/log/common/log'
import {
  ProcessClientChannel,
  ProcessClientChannelId,
} from '@app/services/port-manager/node/ProcessClientChannel'
import {
  ProcessPingClientFactoryId,
  ProcessPingClient,
} from '@app/services/ping/node/ProcessPingClient'
import { TELEGRAPH_PROJECT_NAME } from '@app/core/node/process/env'

import {
  WorkbenchClient,
  servicePath as workspaceServicePath,
} from '@app/services/workbench/common/config'
import { ProxyRPCClient } from '@x-oasis/async-call-rpc'
import type { IWorkbenchProsify } from '@app/services/workbench/common/types'

import { CommonNodeLogger } from '@app/services/log/node/nodeLogger'
import ApplicationInfo, { ApplicationInfoId } from '@app/services/application-info/node'
import PageletProcessNode, { PageletProcessNodeId } from './PageletProcessNode'

const projectName = process.env[TELEGRAPH_PROJECT_NAME]

export default new Registry(bind => {
  bind(PageletProcessNodeId).to(PageletProcessNode)
  bind(ApplicationInfoId).to(ApplicationInfo)
  bind(LogServiceId).toDynamicValue(({ container }) => {
    const { rootTraceId, appVersion, appName } = container.get(ApplicationInfoId).getAppInfo()
    return new LogService({
      logger: new CommonNodeLogger({
        bizName: projectName!,
        rootTraceId,
        appName,
        appVersion,
      }),
    })
  })
  bind(ProcessPingClientFactoryId).toParamsFactory(ProcessPingClient)
  bind(ProcessClientChannelId).to(ProcessClientChannel)
  bind(WorkbenchClient).toDynamicValue(({ container }) => {
    const channelClient = container.get(ProcessClientChannelId)

    return new ProxyRPCClient(workspaceServicePath, {
      channel: channelClient.mainProcessChannelProtocol,
    }).createProxy<IWorkbenchProsify>()
  })
})
