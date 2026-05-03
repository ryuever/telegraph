import type { BrowserWindow } from 'electron'
import { app, session } from 'electron'

import { inject, injectable, createId } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { fromNodeEvent, once } from '@x-oasis/emitter'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId, LogServicePath } from '@app/services/log/common/log'

import type SharedProcessMain from '@app/services/process/shared-process/electron-main/SharedProcessMain'
import { SharedProcessMainId } from '@app/services/process/shared-process/electron-main/SharedProcessMain'

import type DaemonProcessMain from '@app/services/process/daemon-process/electron-main/DaemonProcessMain'
import { DaemonProcessMainId } from '@app/services/process/daemon-process/electron-main/DaemonProcessMain'

import type MainProcess from '@app/services/process/main-process/electron-main/MainProcess'
import { MainProcessId } from '@app/services/process/main-process/electron-main/MainProcess'

import type { AcquirePortMain } from '@app/services/port-manager/electron-main/AcquirePortMain'
import { AcquirePortId } from '@app/services/port-manager/electron-main/AcquirePortMain'

import type UtilityProcess from '@app/core/electron-main/utility-process/utilityProcess'

import { AccountId } from '@app/services/account/electron-main/Account'
import type Account from '@app/services/account/electron-main/Account'

import type { FileAccess } from '@app/services/file-access/electron-main/FileAccess'
import { FileAccessId } from '@app/services/file-access/electron-main/FileAccess'
import { StorageClient as StorageServiceClient } from '@app/services/storage/common/config'
import type { StorageService } from '@app/services/storage/common/config'

import type { Workbench } from '@app/services/workbench/electron-main/Workbench'
import { WorkbenchId } from '@app/services/workbench/electron-main/Workbench'
import { servicePath as workbenchServicePath } from '@app/services/workbench/common/config'

import { servicePath as AccountServicePath } from '@app/services/account/common/config'
import type { WindowManager } from '@app/services/window-manager/electron-main/WindowManager'
import { WindowManagerId } from '@app/services/window-manager/electron-main/WindowManager'
import { TELEGRAPH_PAGELET_RENDERER_PROCESS_ID } from '@app/core/node/process/env'
import type { TelegraphMenu } from '@app/services/telegraph-menu/electron-main/TelegraphMenu'
import { TelegraphMenuId } from '@app/services/telegraph-menu/electron-main/TelegraphMenu'
import {
  ClientLaunchLog,
  PerformanceStage,
  TrackerEvent,
} from '@app/services/log/common/constants'
import {
  FileSystemManagerId,
  FileSystemServicePath,
} from '@app/services/file-manager/common/config'
import type { FileSystemManager } from '@app/services/file-manager/electron-main'
import {
  MainProcessUtilsId,
  MainProcessUtilsServicePath,
} from '@app/services/main-process-util/common/config'
import type { MainProcessUtils } from '@app/services/main-process-util/electron-main'
import {
  MonitorBridgeId,
  monitorServicePath,
} from '@app/services/monitor/common/config'
import type { MonitorBridge } from '@app/services/monitor/electron-main/MonitorBridge'
import { PerformanceTracker } from '@app/services/log/common/performance'
import { initCrashListener } from './helper/crash'
import { initAboutInfo } from './helper/about'

export const TelegraphApplicationId = createId('telegraph-application')

@injectable()
class TelegraphApplication extends Disposable {
  private sharedProcess: UtilityProcess

  private daemonProcess: UtilityProcess

  private performanceTracker: PerformanceTracker

  onWillQuitEvent = fromNodeEvent(app, 'will-quit')

  onWindowAllClosedEvent = fromNodeEvent(app, 'window-all-closed')

  constructor(
    @inject(FileAccessId) private fileAccess: FileAccess,
    @inject(LogServiceId) private logService: LogService,
    @inject(MainProcessId) private mainProcess: MainProcess,
    @inject(TelegraphMenuId) private telegraphMenu: TelegraphMenu,
    @inject(StorageServiceClient) private storageServiceClient: StorageService,
    @inject(AccountId) private account: Account,
    @inject(WorkbenchId) private workbench: Workbench,
    @inject(WindowManagerId) private windowManager: WindowManager,
    @inject(SharedProcessMainId) private sharedProcessMain: SharedProcessMain,
    @inject(DaemonProcessMainId) private daemonProcessMain: DaemonProcessMain,
    @inject(AcquirePortId) private acquirePortMain: AcquirePortMain,
    @inject(FileSystemManagerId) private fileSystemManager: FileSystemManager,
    @inject(MainProcessUtilsId) private mainProcessUtils: MainProcessUtils,
    @inject(MonitorBridgeId) private monitorBridge: MonitorBridge
  ) {
    super()
    this.performanceTracker = new PerformanceTracker(this.logService.trace.bind(this.logService))
  }

  /**
   * 监听登录成功后，初始化一些配置
   */
  private onAccountLogged() {
    this.registerDisposable(
      this.account.onAuthValidationDidFinished(() => {
        if (this.account.isLogged()) {
          const { userId, email } = this.account.account
          this.logService.setUserInfo({
            id: userId,
            email,
          })
          this.fileSystemManager.initUserDir(userId)
        }
      })
    )
  }

  start() {
    this.logService.trace(TrackerEvent.TelegraphAppLaunch)
    this.logService.info(ClientLaunchLog.AppStart)
    this.performanceTracker.start(PerformanceStage.AppLaunch)

    initAboutInfo()
    // 监听 crash
    initCrashListener(this.logService)
    this.acquirePortMain.initAcquirePort(
      this.sharedProcessMain,
      this.daemonProcessMain,
      this.mainProcess,
      this.windowManager,
      this.mainProcess.serviceHost
    )

    /**
     * initialization to avoid circuit import
     */
    this.sharedProcessMain.initialize(this.windowManager, this.daemonProcessMain)
    this.daemonProcessMain.initialize(this.windowManager, this.sharedProcessMain)

    // 初始化shared process，包含storage service
    this.setupSharedProcessMain()
    this.setupDaemonProcessMain()
    this.performanceTracker.start(PerformanceStage.GetProfile)
    this.logService.info(ClientLaunchLog.GetUserProfile)
    // 监听登录成功
    this.onAccountLogged()
    this.storageServiceClient.getProfile().then((value: any) => {
      this.registerDisposable(
        once(this.account.onAuthValidationDidFinished)(() => {
          this.logService.info(ClientLaunchLog.ValidAuthEnd)
          this.performanceTracker.end(PerformanceStage.ValidAuth)
          this.registerListener()
          this.initMainWindow()
          this.prepareMainProcess()
        })
      )
      this.logService.info(ClientLaunchLog.ValidAuthStart)
      this.performanceTracker.end(PerformanceStage.GetProfile)
      this.performanceTracker.start(PerformanceStage.ValidAuth)
      this.account.handleAuthValidation(value)
    })
  }

  prepareMainProcess() {
    this.mainProcess.registerServiceHandler(AccountServicePath, this.account)
    this.mainProcess.registerServiceHandler(workbenchServicePath, this.workbench)
    this.mainProcess.registerServiceHandler(LogServicePath, this.logService)
    this.mainProcess.registerServiceHandler(FileSystemServicePath, this.fileSystemManager)
    this.mainProcess.registerServiceHandler(MainProcessUtilsServicePath, this.mainProcessUtils)
    this.mainProcess.registerServiceHandler(monitorServicePath, this.monitorBridge)
  }

  initMainWindow() {
    this.telegraphMenu.init()
    this.workbench.createMainWindow()
    this.registerDisposable(
      this.workbench.onDidMainWindowCreated(async (window: BrowserWindow) => {
        // @ts-ignore
        session.defaultSession.webRequest.onBeforeRedirect(async (details, callback) => {
          try {
            // 拦截扫码登录重定向，换到登录ticket去登录
            if (details.statusCode === 302) {
              const loginReg = /^http(s)?:\/\/login2(\.sit)?\.xiaohongshu\.com\/*./
              const isLoginRedirect = loginReg.test(details.url)
              if (isLoginRedirect) {
                const ticket = details.redirectURL.split('ticket=')[1]

                await this.account.scanLogin(ticket)
                window.loadURL(
                  ...this.fileAccess.asLoadURL(
                    `/app?${TELEGRAPH_PAGELET_RENDERER_PROCESS_ID}=main-renderer-app`
                  )
                )
              }
              callback(true)
            } else {
              callback(false)
            }
          } catch (error) {
            console.log(error, 'error')
          }
        })
        const isLogged = this.account.isLogged()
        this.performanceTracker.start(PerformanceStage.LoadMainPage)
        this.logService.info(ClientLaunchLog.LoadMainPageStart)
        // load url on main process renderer, so it does not have dedicated pagelet process.
        await this.loadMainPage(window, isLogged)
        this.logService.info(ClientLaunchLog.AppEnd)
        this.performanceTracker.end(PerformanceStage.LoadMainPage)
        this.performanceTracker.end(PerformanceStage.AppLaunch)
      })
    )
  }

  async loadMainPage(window: BrowserWindow, isLogged: boolean) {
    try {
      if (isLogged) {
        await window.loadURL(
          ...this.fileAccess.asLoadURL(
            `/app?${TELEGRAPH_PAGELET_RENDERER_PROCESS_ID}=main-renderer-app`
          )
        )
      } else {
        await window.loadURL(
          ...this.fileAccess.asLoadURL(
            `/login?${TELEGRAPH_PAGELET_RENDERER_PROCESS_ID}=main-renderer-login`
          )
        )
      }
    } catch (error) {
      this.logService.error(ClientLaunchLog.LoadMainPageFail, error.message)
    }
  }

  registerListener() {
    this.registerDisposable(this.onWillQuitEvent(this.onWillQuit.bind(this)))
    this.registerDisposable(this.onWindowAllClosedEvent(this.onWindowAllClosed.bind(this)))
  }

  setupSharedProcessMain() {
    this.sharedProcess = this.sharedProcessMain.createUtilityProcess()

    // setTimeout(() => {
    //   this.sharedProcessMain.handleProcessDisposed()
    // }, 4000)

    // setTimeout(() => {
    //   this.sharedProcessMain.handleResumeConnection()
    // }, 6000)
  }

  setupDaemonProcessMain() {
    this.daemonProcess = this.daemonProcessMain.createUtilityProcess()
    //   this.mainProcess.registerProcess('daemon-process', this.daemonProcess)
    //   this.mainProcess.connectToProcess('daemon-process')
  }

  onWillQuit() {
    this.logService.info(ClientLaunchLog.AppWillQuit)
  }

  onWindowAllClosed() {
    app.quit()
  }
}

export default TelegraphApplication
