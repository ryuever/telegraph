import { Registry } from '@x-oasis/di'
import { LogService, LogServiceId } from '@telegraph/services/log/common/log'
import Diagnostics, { DiagnosticsId } from '@telegraph/services/diagnostics/node/Diagnostics'
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
import {
  MainProcessUtilsClient,
  MainProcessUtilsServicePath,
} from '@telegraph/services/main-process-util/common/config'
import type { IMainProcessUtils } from '@telegraph/services/main-process-util/common/types'
import {
  MonitorBridgeClient,
  monitorServicePath,
} from '@telegraph/services/monitor/common/config'
import type { IMonitorBridge } from '@telegraph/services/monitor/common/types'
import DaemonProcessNode, { DaemonProcessNodeId } from './DaemonProcessNode'
import AgentStreamService, { AgentStreamServiceId } from '@telegraph/services/agent/node/AgentStreamService'

export default new Registry(bind => {
  bind(AgentStreamServiceId).to(AgentStreamService)
  bind(DaemonProcessNodeId).to(DaemonProcessNode)
  bind(ApplicationInfoId).to(ApplicationInfo)
  bind(DiagnosticsId).to(Diagnostics)
  bind(LogServiceId).toDynamicValue(({ container }) => {
    const { rootTraceId, appVersion, appName } = container.get(ApplicationInfoId).getAppInfo()
    return new LogService({
      logger: new CommonNodeLogger({
        bizName: 'daemon-process',
        rootTraceId,
        appVersion,
        appName,
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

  bind(MainProcessUtilsClient).toDynamicValue(({ container }) => {
    const channelClient = container.get(ProcessClientChannelId)

    return new ProxyRPCClient(MainProcessUtilsServicePath, {
      channel: channelClient.mainProcessChannelProtocol,
    }).createProxy() as unknown as IMainProcessUtils
  })

  bind(MonitorBridgeClient).toDynamicValue(({ container }) => {
    const channelClient = container.get(ProcessClientChannelId)

    return new ProxyRPCClient(monitorServicePath, {
      channel: channelClient.mainProcessChannelProtocol,
    }).createProxy() as unknown as IMonitorBridge
  })
})
