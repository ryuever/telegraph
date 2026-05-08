export enum StorageScope {
  // 应用维度的针对所有的user
  APPLICATION = 'application',

  // 用户的配置信息，比如vscode中的setting
  PROFILE = 'profile',

  // 某一个Page下的存储信息
  WORKBENCH = 'workbench',
}

export enum StorageTarget {
  USER = 'user',

  MACHINE = 'machine',
}

export type StorageValue = string | boolean | number | undefined | null | object

export interface IStorageEntry {
  readonly key: string
  readonly value: StorageValue
  readonly scope: StorageScope
  readonly target: StorageTarget
}
