import { Disposable } from '@x-oasis/disposable'
import { injectable, createId, inject } from '@x-oasis/di'
import { Emitter } from '@x-oasis/emitter'
import { login, loginTotp, queryUserInfo } from '@app/services/account/common/login'
import { StorageClient as StorageServiceClient } from '@app/services/storage/common/config'
import type { StorageService } from '@app/services/storage/common/config'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId } from '@app/services/log/common/log'
import { AccountLog } from '@app/services/log/common/constants'
import type { AccountInfo, LoginInfo } from './types'

export const AccountId = createId('account-id')

@injectable()
class Account extends Disposable {
  private _logged: boolean

  private _account: AccountInfo

  private _emitter = new Emitter({ name: 'account' })

  private onAuthValidationDidFinishedEvent = this._emitter.register(
    'on-auth-validation-did-finished-event'
  )

  onAuthValidationDidFinished = this.onAuthValidationDidFinishedEvent.subscribe

  constructor(
    @inject(StorageServiceClient) private storageServiceClient: StorageService,
    @inject(LogServiceId) private logService: LogService
  ) {
    super()
  }

  isLogged() {
    return this._logged
  }

  saveAccount(account?: AccountInfo) {
    if (account && account.ticket) {
      this._account = account
      this._logged = true
      this.storageServiceClient.setProfile(account)
    } else {
      this._account = account
      this._logged = false
    }

    this.onAuthValidationDidFinishedEvent.fire(account)
  }

  handleAuthValidation(value?: LoginInfo) {
    if (!value) {
      this.saveAccount()
    } else {
      queryUserInfo(value.ticket).then((account: AccountInfo) => {
        this.saveAccount(account)
      })
    }
  }

  get account() {
    return this._account
  }

  async handleLogin(info: { username: string; password: string }) {
    try {
      const account = await login(info)
      this.saveAccount(account)
      return account
    } catch (error) {
      this.logService.error(AccountLog.NormalLoginFail, error.message)
      throw error
    }
  }

  async scanLogin(ticket: string) {
    try {
      const account = await queryUserInfo(ticket)
      this.saveAccount(account)
      return account
    } catch (error) {
      this.logService.error(AccountLog.ScanLoginFail, error.message)
      throw error
    }
  }

  async handleLoginOPT(info: { username: string; password: string }) {
    try {
      const account = await loginTotp(info)
      this.saveAccount(account)
      return account
    } catch (error) {
      this.logService.error(AccountLog.OPTLoginFail, error.message)
      throw error
    }
  }
}

export default Account
