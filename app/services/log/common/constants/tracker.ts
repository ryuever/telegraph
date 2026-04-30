export const TrackerEvent = {
  RedCityPerformance: 'pc_redcity_performance',
  RedCityStabilityValues: 'pc_redcity_stability_values',
  RedCityAppLaunch: 'pc_redcity_app_launch',
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
