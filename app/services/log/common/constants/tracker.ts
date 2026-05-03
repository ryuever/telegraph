export const TrackerEvent = {
  TelegraphPerformance: 'pc_telegraph_performance',
  TelegraphStabilityValues: 'pc_telegraph_stability_values',
  TelegraphAppLaunch: 'pc_telegraph_app_launch',
}

export enum PerformanceStage {
  AppLaunch = 'appLaunch',
  GetProfile = 'getProfile',
  ValidAuth = 'validAuth',
  LoadMainPage = 'loadMainPage',
  LoadAppPage = 'loadAppPage',
  WaitAppReady = 'waitAppReady',
  CreateMainWindow = 'createMainWindow',
  CreateBrowserView = 'createBrowserView',
}

export enum TrackerScene {
  AppUsedMemory = 'appUsedMemory',
  AppUsedCPU = 'appUsedCPU',
}
