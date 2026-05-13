import { app, dialog } from 'electron'
import fs from 'node:fs'
import fsPromise from 'node:fs/promises'
import nodePath from 'node:path'
import { inject, injectable } from '@x-oasis/di'
import type { LogService } from '@telegraph/services/log/common/log'
import { LogServiceId } from '@telegraph/services/log/common/log'
import { FileSystemManagerLog } from '@telegraph/services/log/common/constants'
import { FileCode, FilePathType } from '../common/types'
import type { IFileSystemManager } from '../common/types'
import { TempAppName } from '../common/config'

@injectable()
export class FileSystemManager implements IFileSystemManager {
  private userDir: string

  private tempDir: string

  constructor(@inject(LogServiceId) private logService: LogService) {
    this.initTempDir()
  }

  private async ensureDir(path: string) {
    if (!fs.existsSync(path)) {
      const dir = nodePath.dirname(path)
      await fsPromise.mkdir(dir, { recursive: true })
    }
  }

  private initTempDir() {
    this.tempDir = nodePath.join(app.getPath('temp'), TempAppName)
    app.setPath('temp', this.tempDir)
  }

  initUserDir(userId: string) {
    this.logService.info(FileSystemManagerLog.InitUserDir)
    this.userDir = nodePath.join(app.getPath('userData'), userId)
    app.setPath('userData', this.userDir)
  }

  getUserDir: IFileSystemManager['getUserDir'] = async () => {
    return this.userDir
  }

  getTempDir: IFileSystemManager['getTempDir'] = async () => {
    return this.tempDir
  }

  getFilePath(fileName: string, type: FilePathType) {
    const dir = type === FilePathType.User ? this.userDir : this.tempDir
    return dir ? nodePath.join(dir, fileName) : ''
  }

  getFileStats: IFileSystemManager['getFileStats'] = async path => {
    try {
      const { size, ctime, mtime } = await fsPromise.stat(path)
      return {
        code: FileCode.Success,
        size,
        ctime: ctime.getTime(),
        mtime: mtime.getTime(),
      }
    } catch (error) {
      this.logService.error(FileSystemManagerLog.GetFileStatsError, error.message)
      return {
        code: FileCode.Fail,
      }
    }
  }

  readFile: IFileSystemManager['readFile'] = async (path, encoding) => {
    try {
      const res = await fsPromise.readFile(path, {
        encoding,
      })
      return {
        code: FileCode.Success,
        data: res,
      }
    } catch (error) {
      this.logService.error(FileSystemManagerLog.ReadFileError, error.message)
      return {
        code: FileCode.Fail,
      }
    }
  }

  readTempFile: IFileSystemManager['readTempFile'] = async (fileName, encoding) => {
    const path = this.getFilePath(fileName, FilePathType.Temp)
    if (path) {
      return this.readFile(path, encoding)
    }
    return {
      code: FileCode.NotExist,
    }
  }

  readUserFile: IFileSystemManager['readUserFile'] = async (fileName, encoding) => {
    const path = this.getFilePath(fileName, FilePathType.User)
    if (path) {
      return this.readFile(path, encoding)
    }
    return {
      code: FileCode.NotExist,
    }
  }

  onReadFileWithStream: IFileSystemManager['onReadFileWithStream'] = async (onData, options) => {
    const { path, encoding, highWaterMark } = options
    try {
      const fd = await fsPromise.open(path)
      fd.createReadStream({
        highWaterMark,
        encoding,
      })
        .on('data', chunk => {
          onData(chunk)
        })
        .on('end', () => {
          onData(null)
        })
        .on('error', err => {
          this.logService.error(FileSystemManagerLog.OnReadFileWithStream, err.message)
        })
      return {
        code: FileCode.Success,
      }
    } catch (error) {
      this.logService.error(FileSystemManagerLog.OnReadFileWithStream, error.message)
      return {
        code: FileCode.Fail,
      }
    }
  }

  writeFile: IFileSystemManager['writeFile'] = async (path, data, encoding) => {
    try {
      await this.ensureDir(path)
      await fsPromise.writeFile(path, data as string, {
        encoding,
      })
      return {
        code: FileCode.Success,
      }
    } catch (error) {
      this.logService.error(FileSystemManagerLog.WriteFileError, error.message)
      return {
        code: FileCode.Fail,
      }
    }
  }

  writeTempFile: IFileSystemManager['writeTempFile'] = async (fileName, data, encoding) => {
    const path = this.getFilePath(fileName, FilePathType.Temp)
    if (path) {
      return this.writeFile(path, data, encoding)
    }
    return {
      code: FileCode.NotExist,
    }
  }

  writeUserFile: IFileSystemManager['writeUserFile'] = async (fileName, data, encoding) => {
    const path = this.getFilePath(fileName, FilePathType.User)
    if (path) {
      return this.writeFile(path, data, encoding)
    }
    return {
      code: FileCode.NotExist,
    }
  }

  appendFile: IFileSystemManager['appendFile'] = async (path, data, encoding) => {
    try {
      await this.ensureDir(path)
      await fsPromise.appendFile(path, data as string, {
        encoding,
      })
      return {
        code: FileCode.Success,
      }
    } catch (error) {
      this.logService.error(FileSystemManagerLog.AppendFileError, error.message)
      return {
        code: FileCode.Fail,
      }
    }
  }

  chooseFiles: IFileSystemManager['chooseFiles'] = async options => {
    try {
      const { canceled, filePaths } = await dialog.showOpenDialog(options ?? {})
      if (canceled) {
        return {
          paths: [],
          code: FileCode.Cancel,
        }
      }
      return {
        paths: filePaths,
        code: FileCode.Success,
      }
    } catch (error) {
      this.logService.error(FileSystemManagerLog.ChooseFileError, error.message)
      return {
        paths: [],
        code: FileCode.Fail,
      }
    }
  }

  saveFile: IFileSystemManager['saveFile'] = async (fromPath, toPath) => {
    try {
      await fsPromise.copyFile(fromPath, toPath)
      return {
        code: FileCode.Success,
      }
    } catch (error) {
      this.logService.error(FileSystemManagerLog.SaveFileError, error.message)
      return {
        code: FileCode.Fail,
      }
    }
  }

  saveFileAs: IFileSystemManager['saveFileAs'] = async (fromPath, options) => {
    try {
      const { canceled, filePath } = await dialog.showSaveDialog(options ?? {})
      if (canceled) {
        return {
          code: FileCode.Cancel,
          path: '',
        }
      }
      await fsPromise.copyFile(fromPath, filePath!)
      return {
        code: FileCode.Success,
        path: filePath,
      }
    } catch (error) {
      this.logService.error(FileSystemManagerLog.SaveFileErrorAs, error.message)
      return {
        code: FileCode.Fail,
      }
    }
  }
}
