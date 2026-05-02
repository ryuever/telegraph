import * as path from 'path'

import { Registry } from '@x-oasis/di'

import { ProjectRegistryId, Projects } from '@app/services/project-registry/electron-main/ProjectRegistry'

class EmptyProjects extends Projects {
  getLoadConfigs() {
    return []
  }
}

import { FileAccess, FileAccessId } from '@app/services/file-access/electron-main/FileAccess'
import { LogService, LogServiceId } from '@app/services/log/common/log'
import { Workbench, WorkbenchId } from '@app/services/workbench/electron-main/Workbench'
import {
  BrowserWindowFactoryId,
  BrowserWindow,
} from '@app/services/window-manager/electron-main/BrowserWindow'
import {
  WindowManagerId,
  WindowManager,
} from '@app/services/window-manager/electron-main/WindowManager'

import UtilityProcess, {
  UtilityProcessFactoryId,
} from '@app/core/electron-main/utility-process/utilityProcess'
import SharedProcessMain, {
  SharedProcessMainId,
} from '@app/services/process/shared-process/electron-main/SharedProcessMain'
import DaemonProcessMain, {
  DaemonProcessMainId,
} from '@app/services/process/daemon-process/electron-main/DaemonProcessMain'
import MainProcess, {
  MainProcessId,
} from '@app/services/process/main-process/electron-main/MainProcess'
import PageletProcess, {
  PageletProcessFactoryId,
} from '@app/services/process/pagelet-process/electron-main/PageletProcess'
import ApplicationInfo, { ApplicationInfoId } from '@app/services/application-info/node'
import {
  AcquirePortId,
  AcquirePortMain,
} from '@app/services/port-manager/electron-main/AcquirePortMain'

import Panel, { PanelFactoryId } from '@app/services/tabs/electron-main/Panel'
import Pagelet, { PageletFactoryId } from '@app/services/tabs/electron-main/Pagelet'
import DisposablePanel, {
  DisposablePanelFactoryId,
} from '@app/services/tabs/electron-main/DisposablePanel'
import DisposablePagelet, {
  DisposablePageletFactoryId,
} from '@app/services/tabs/electron-main/DisposablePagelet'

import {
  StorageClient as StorageServiceClient,
  servicePath as StorageServicePath,
} from '@app/services/storage/common/config'

import {
  ProcessPingMainFactoryId,
  ProcessPingMain,
} from '@app/services/ping/electron-main/ProcessPingMain'

import Account, { AccountId } from '@app/services/account/electron-main/Account'

import RedcityApplication, { RedcityApplicationId } from '@app/application/redcity-application'

import {
  RedcityMenu,
  RedcityMenuId,
} from '@app/services/redcity-menu/electron-main/RedcityMenu'

/**
 * =========================== factory ===========================
 */
import {
  AcquireProcessPortMain,
  AcquireProcessPortMainFactoryId,
} from '@app/services/port-manager/electron-main/AcquireProcessPortMain'

import { ProxyRPCClient } from '@app/core/common/async-rpc-compat'
import { CommonNodeLogger } from '@app/services/log/electron-main/nodeLogger'
import { FileSystemManager } from '@app/services/file-manager/electron-main'
import { FileSystemManagerId } from '@app/services/file-manager/common/config'
import { MainProcessUtils } from '@app/services/main-process-util/electron-main'
import { MainProcessUtilsId } from '@app/services/main-process-util/common/config'
import { MonitorBridge } from '@app/services/monitor/electron-main/MonitorBridge'
import { MonitorBridgeId } from '@app/services/monitor/common/config'

export default new Registry(bind => {
  bind(ApplicationInfoId).to(ApplicationInfo)
  bind(RedcityApplicationId).to(RedcityApplication)
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
        '@app': path.resolve('.', 'app'),
        '@build': path.resolve(__dirname),
        '@dev': 'http://localhost:5173',
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

  bind(RedcityMenuId).to(RedcityMenu)

  bind(PageletFactoryId).toParamsFactory(Pagelet)
  bind(PanelFactoryId).toParamsFactory(Panel)
  bind(DisposablePanelFactoryId).toParamsFactory(DisposablePanel)
  bind(DisposablePageletFactoryId).toParamsFactory(DisposablePagelet)

  bind(StorageServiceClient).toDynamicValue(({ container }) => {
    const mainProcess = container.get(MainProcessId)
    return new ProxyRPCClient({
      requestPath: StorageServicePath,
      channel: mainProcess.getSharedProcessChannel(),
    }).createProxy()
  })

  bind(AccountId).to(Account)

  bind(AcquirePortId).to(AcquirePortMain)
  bind(ProcessPingMainFactoryId).toParamsFactory(ProcessPingMain)
  bind(AcquireProcessPortMainFactoryId).toParamsFactory(AcquireProcessPortMain)
  bind(FileSystemManagerId).to(FileSystemManager)
  bind(MonitorBridgeId).to(MonitorBridge)
})
