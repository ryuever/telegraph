import * as path from 'path'

import { Registry } from '@x-oasis/di'

import { ProjectRegistryId, Projects } from '@telegraph/services/project-registry/electron-main/ProjectRegistry'

class EmptyProjects extends Projects {
  getLoadConfigs() {
    return []
  }
}

import { FileAccess, FileAccessId } from '@telegraph/services/file-access/electron-main/FileAccess'
import { LogService, LogServiceId } from '@telegraph/services/log/common/log'
import { Workbench, WorkbenchId } from '@telegraph/services/workbench/electron-main/Workbench'
import {
  BrowserWindowFactoryId,
  BrowserWindow,
} from '@telegraph/services/window-manager/electron-main/BrowserWindow'
import {
  WindowManagerId,
  WindowManager,
} from '@telegraph/services/window-manager/electron-main/WindowManager'

import UtilityProcess, {
  UtilityProcessFactoryId,
} from '@telegraph/core/electron-main/utility-process/utilityProcess'
import SharedProcessMain, {
  SharedProcessMainId,
} from '@telegraph/services/process/shared-process/electron-main/SharedProcessMain'
import DaemonProcessMain, {
  DaemonProcessMainId,
} from '@telegraph/services/process/daemon-process/electron-main/DaemonProcessMain'
import MainProcess, {
  MainProcessId,
} from '@telegraph/services/process/main-process/electron-main/MainProcess'
import PageletProcess, {
  PageletProcessFactoryId,
} from '@telegraph/services/process/pagelet-process/electron-main/PageletProcess'
import ApplicationInfo, { ApplicationInfoId } from '@telegraph/services/application-info/node'
import {
  AcquirePortId,
  AcquirePortMain,
} from '@telegraph/services/port-manager/electron-main/AcquirePortMain'

import Panel, { PanelFactoryId } from '@telegraph/services/tabs/electron-main/Panel'
import Pagelet, { PageletFactoryId } from '@telegraph/services/tabs/electron-main/Pagelet'
import DisposablePanel, {
  DisposablePanelFactoryId,
} from '@telegraph/services/tabs/electron-main/DisposablePanel'
import DisposablePagelet, {
  DisposablePageletFactoryId,
} from '@telegraph/services/tabs/electron-main/DisposablePagelet'

import {
  StorageClient as StorageServiceClient,
  servicePath as StorageServicePath,
} from '@telegraph/services/storage/common/config'

import {
  ProcessPingMainFactoryId,
  ProcessPingMain,
} from '@telegraph/services/ping/electron-main/ProcessPingMain'

import Account, { AccountId } from '@telegraph/services/account/electron-main/Account'

import TelegraphApplication, { TelegraphApplicationId } from '@telegraph/application/telegraph-application'

import {
  TelegraphMenu,
  TelegraphMenuId,
} from '@telegraph/services/telegraph-menu/electron-main/TelegraphMenu'

/**
 * =========================== factory ===========================
 */
import {
  AcquireProcessPortMain,
  AcquireProcessPortMainFactoryId,
} from '@telegraph/services/port-manager/electron-main/AcquireProcessPortMain'

import { ProxyRPCClient } from '@x-oasis/async-call-rpc'
import { CommonNodeLogger } from '@telegraph/services/log/electron-main/nodeLogger'
import { FileSystemManager } from '@telegraph/services/file-manager/electron-main'
import { FileSystemManagerId } from '@telegraph/services/file-manager/common/config'
import { MainProcessUtils } from '@telegraph/services/main-process-util/electron-main'
import { MainProcessUtilsId } from '@telegraph/services/main-process-util/common/config'
import { MonitorBridge } from '@telegraph/services/monitor/electron-main/MonitorBridge'
import { MonitorBridgeId } from '@telegraph/services/monitor/common/config'
import AgentStreamSink from '@telegraph/services/agent/electron-main/AgentStreamSink'
import { AgentStreamSinkId } from '@telegraph/services/agent/common/config'

export default new Registry(bind => {
  bind(ApplicationInfoId).to(ApplicationInfo)
  bind(TelegraphApplicationId).to(TelegraphApplication)
  bind(LogServiceId).toDynamicValue(({ container }) => {
    const { rootTraceId, appVersion, appName } = container.get(ApplicationInfoId).getAppInfo()
    return new LogService({
      logger: new CommonNodeLogger({
        bizName: 'main',
        rootTraceId,
        appVersion,
        appName,
      }),
    })
  })
  bind(FileAccessId).toConstantValue(
    new FileAccess({
      alias: {
        '@root': path.resolve('.'),
        '@telegraph': path.resolve('.'),
        '@build': path.resolve(__dirname),
        '@dev': 'http://127.0.0.1:5173',
      },
    })
  )
  bind(MainProcessUtilsId).toConstantValue(new MainProcessUtils())
  bind(WorkbenchId).to(Workbench)
  bind(WindowManagerId).to(WindowManager)
  bind(ProjectRegistryId).toConstantValue(new EmptyProjects())
  bind(BrowserWindowFactoryId).toParamsFactory(BrowserWindow)
  bind(UtilityProcessFactoryId).toParamsFactory(UtilityProcess)
  bind(SharedProcessMainId).to(SharedProcessMain)
  bind(DaemonProcessMainId).to(DaemonProcessMain)
  bind(MainProcessId).to(MainProcess)
  bind(PageletProcessFactoryId).toParamsFactory(PageletProcess)

  bind(TelegraphMenuId).to(TelegraphMenu)

  bind(PageletFactoryId).toParamsFactory(Pagelet)
  bind(PanelFactoryId).toParamsFactory(Panel)
  bind(DisposablePanelFactoryId).toParamsFactory(DisposablePanel)
  bind(DisposablePageletFactoryId).toParamsFactory(DisposablePagelet)

  bind(StorageServiceClient).toDynamicValue(({ container }) => {
    const mainProcess = container.get(MainProcessId)
    return new ProxyRPCClient(StorageServicePath, {
      channel: mainProcess.getSharedProcessChannel(),
    }).createProxy()
  })

  bind(AccountId).to(Account)

  bind(AcquirePortId).to(AcquirePortMain)
  bind(ProcessPingMainFactoryId).toParamsFactory(ProcessPingMain)
  bind(AcquireProcessPortMainFactoryId).toParamsFactory(AcquireProcessPortMain)
  bind(FileSystemManagerId).to(FileSystemManager)
  bind(MonitorBridgeId).to(MonitorBridge)
  bind(AgentStreamSinkId).to(AgentStreamSink)
})
