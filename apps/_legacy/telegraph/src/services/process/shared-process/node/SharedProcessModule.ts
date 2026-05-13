import { Registry } from '@x-oasis/di'
import { LogService, LogServiceId } from '@telegraph/services/log/common/log'
import StorageService, { StorageServiceId } from '@telegraph/services/storage/node/StorageService'
import {
  ProcessClientChannel,
  ProcessClientChannelId,
} from '@telegraph/services/port-manager/node/ProcessClientChannel'
import {
  ProcessPingClientFactoryId,
  ProcessPingClient,
} from '@telegraph/services/ping/node/ProcessPingClient'
import {
  WorkbenchClient,
  servicePath as workspaceServicePath,
} from '@telegraph/services/workbench/common/config'
import { ProxyRPCClient } from '@x-oasis/async-call-rpc'
import type { IWorkbenchProsify } from '@telegraph/services/workbench/common/types'
import { CommonNodeLogger } from '@telegraph/services/log/node/nodeLogger'
import ApplicationInfo, { ApplicationInfoId } from '@telegraph/services/application-info/node'
import SharedProcessNode, { SharedProcessNodeId } from './SharedProcessNode'

export default new Registry(bind => {
  bind(SharedProcessNodeId).to(SharedProcessNode)
  bind(ApplicationInfoId).to(ApplicationInfo)
  bind(LogServiceId).toDynamicValue(({ container }) => {
    const { rootTraceId, appVersion, appName } = container.get(ApplicationInfoId).getAppInfo()
    return new LogService({
      logger: new CommonNodeLogger({
        bizName: 'share-process',
        rootTraceId,
        appName,
        appVersion,
      }),
    })
  })
  bind(StorageServiceId).to(StorageService)
  bind(ProcessPingClientFactoryId).toParamsFactory(ProcessPingClient)
  bind(ProcessClientChannelId).to(ProcessClientChannel)

  bind(WorkbenchClient).toDynamicValue(({ container }) => {
    const channelClient = container.get(ProcessClientChannelId)

    return new ProxyRPCClient(workspaceServicePath, {
      channel: channelClient.mainProcessChannelProtocol,
    }).createProxy<IWorkbenchProsify>()
  })
})
