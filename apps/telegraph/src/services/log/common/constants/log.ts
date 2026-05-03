export enum ClientLaunchLog {
  AppStart = 'start client',
  GetUserProfile = 'get user profile',
  ValidAuthStart = 'start valid auth',
  ValidAuthEnd = 'valid auth end',
  LoadMainPageStart = 'start load page',
  LoadMainPageFail = 'load main page fail',
  AppEnd = 'client init end',
  AppWillQuit = 'client will quit',
}

export enum WorkBenchLog {
  WaitAppReady = 'await app ready',
  CreateMainWindowStart = 'start create main window',
  CreateMainWindowEnd = 'create main window success',
  LoadAppPageStart = 'start load app page',
  LoadAppPageEnd = 'load app end',
  CreatePanel = 'create panel',
}

export enum BaseWindowLog {
  CreatePanel = 'create new panel',
  DisposePanel = 'start dispose panel',
}

export enum PanelLog {
  PanelToTop = 'panel will set to top',
  PanelToBackground = 'panel will set to background',
}

export enum PageletLog {
  CreatePageletStart = 'pagelet will create',
  PageletSetTop = 'pagelet will set to top',
  PageletDidSetTop = 'pagelet did set to top',
  CreateBrowserViewStart = 'create browser view start',
  LoadPageletPageSuccess = 'load pagelet page success',
  LoadPageletPageFail = 'load pagelet page fail',
  PageletProcessReused = 'pagelet process reused',
  PageletProcessError = 'pagelet process error',
  PageletDispose = 'pagelet dispose',
}

export enum PortManagerLog {
  ReceiveRequestPort = 'receive request port',
  RequestPort = 'start request port',
  PortResponse = 'receive port response',
  AssignPort = 'passive consumption of port',
  MessageChannelSayHello = 'message channel say hello to peer',
  MessageChannelConnected = 'message channel connected',
  MessageChannelDisconnect = 'message channel disconnect',
}

export enum CrashLog {
  ChildProcessGone = 'child process gone',
  RenderProcessGone = 'render process gone',
}

export enum ChatNodeLog {
  InitIMSdk = 'init im sdk in chat node process',
}

export enum AccountLog {
  NormalLoginFail = 'normal login fail',
  ScanLoginFail = 'scan login fail',
  OPTLoginFail = 'opt login fail',
}

export enum FileSystemManagerLog {
  InitUserDir = 'fileSystem init user dir',
  GetFileStatsError = 'fileSystem get file stats error',
  ReadFileError = 'fileSystem read file error',
  WriteFileError = 'fileSystem write file error',
  AppendFileError = 'fileSystem append file error',
  ChooseFileError = 'fileSystem choose file error',
  SaveFileError = 'fileSystem save file error',
  SaveFileErrorAs = 'fileSystem save file as error',
  OnReadFileWithStream = 'fileSystem onReadFileWithStream error',
}
