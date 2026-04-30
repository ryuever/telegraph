export enum FileCode {
  Success,
  Fail,
  Cancel,
  NotExist,
}

export type FileContentEncoding =
  | 'ascii'
  | 'utf8'
  | 'utf-8'
  | 'utf16le'
  | 'utf-16le'
  | 'ucs2'
  | 'ucs-2'
  | 'base64'
  | 'base64url'
  | 'latin1'
  | 'binary'
  | 'hex'

export interface IFileSystemManager {
  initUserDir: (userId: string) => void
  getUserDir: () => Promise<string>
  getTempDir: () => Promise<string>
  getFileStats: (path: string) => Promise<{
    size?: number
    mtime?: number
    ctime?: number
    code: FileCode
  }>
  readFile: (
    path: string,
    encoding?: FileContentEncoding
  ) => Promise<{
    data?: string | ArrayBuffer
    code: FileCode
  }>
  readTempFile: (
    fileName: string,
    encoding?: FileContentEncoding
  ) => Promise<{
    data?: string | ArrayBuffer
    code: FileCode
  }>
  readUserFile: (
    fileName: string,
    encoding?: FileContentEncoding
  ) => Promise<{
    data?: string | ArrayBuffer
    code: FileCode
  }>
  writeFile: (
    path: string,
    data: string | ArrayBuffer,
    encoding?: FileContentEncoding
  ) => Promise<{
    code: FileCode
  }>
  writeTempFile: (
    fileName: string,
    data: string | ArrayBuffer,
    encoding?: FileContentEncoding
  ) => Promise<{
    code: FileCode
  }>
  writeUserFile: (
    fileName: string,
    data: string | ArrayBuffer,
    encoding?: FileContentEncoding
  ) => Promise<{
    code: FileCode
  }>
  appendFile: (
    path: string,
    data: string | ArrayBuffer,
    encoding?: FileContentEncoding
  ) => Promise<{
    code: FileCode
  }>
  chooseFiles: (options?: {
    title?: string
    defaultPath?: string
    filters?: {
      name: string
      extensions: string[]
    }[]
    properties?: ('openFile' | 'openDirectory' | 'multiSelections')[]
  }) => Promise<{
    paths: string[]
    code: FileCode
  }>
  saveFile: (
    fromPath: string,
    toPath: string
  ) => Promise<{
    code: FileCode
  }>
  saveFileAs: (
    fromPath: string,
    options?: {
      title?: string
      defaultPath?: string
      filters?: {
        name: string
        extensions: string[]
      }[]
    }
  ) => Promise<{
    path?: string
    code: FileCode
  }>
  onReadFileWithStream: (
    onData: (chunk: string | ArrayBuffer | null) => void,
    options: {
      path: string
      encoding?: FileContentEncoding
      highWaterMark?: number
    }
  ) => Promise<{
    code: FileCode
  }>
}

export enum FilePathType {
  User,
  Temp,
}
