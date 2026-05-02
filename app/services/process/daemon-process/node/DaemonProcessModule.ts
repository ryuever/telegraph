import { Registry } from '@x-oasis/di'
import { LogService, LogServiceId } from '@app/services/log/common/log'
import Diagnostics, { DiagnosticsId } from '@app/services/diagnostics/node/Diagnostics'
import StorageService, { StorageServiceId } from '@app/services/storage/node/StorageService'
import {
  ProcessClientChannel,
  ProcessClientChannelId,
} from '@app/services/port-manager/node/ProcessClientChannel'
import {
  ProcessPingClientFactoryId,
  ProcessPingClient,
} from '@app/services/ping/node/ProcessPingClient'
import {
  WorkbenchClient,
  servicePath as workspaceServicePath,
} from '@app/services/workbench/common/config'
import { ProxyRPCClient } from '@app/core/common/async-rpc-compat'
import type { IWorkbenchProsify } from '@app/services/workbench/common/types'

import { CommonNodeLogger } from '@app/services/log/node/nodeLogger'
import ApplicationInfo, { ApplicationInfoId } from '@app/services/application-info/node'
import {
  MainProcessUtilsClient,
  MainProcessUtilsServicePath,
} from '@app/services/main-process-util/common/config'
import type { IMainProcessUtils } from '@app/services/main-process-util/common/types'
import {
  MonitorBridgeClient,
  monitorServicePath,
} from '@app/services/monitor/common/config'
import type { IMonitorBridge } from '@app/services/monitor/common/types'
import DaemonProcessNode, { DaemonProcessNodeId } from './DaemonProcessNode'

export default new Registry(bind => {
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

    return new ProxyRPCClient({
      requestPath: workspaceServicePath,
      channel: channelClient.mainProcessChannelProtocol,
    }).createProxy<IWorkbenchProsify>()
  })

  bind(MainProcessUtilsClient).toDynamicValue(({ container }) => {
    const channelClient = container.get(ProcessClientChannelId)

    return new ProxyRPCClient({
      requestPath: MainProcessUtilsServicePath,
      channel: channelClient.mainProcessChannelProtocol,
    }).createProxy<IMainProcessUtils>()
  })

  bind(MonitorBridgeClient).toDynamicValue(({ container }) => {
    const channelClient = container.get(ProcessClientChannelId)

    return new ProxyRPCClient({
      requestPath: monitorServicePath,
      channel: channelClient.mainProcessChannelProtocol,
    }).createProxy<IMonitorBridge>()
  })
})
