import { injectable, createId } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
// import SQLiteStorageDatabase from './SQLiteStorageDatabase'
import { storeHandlers } from '../common/storeManage'

export const StorageServiceId = createId('storage-service')

@injectable()
export default class StorageService extends Disposable {
  private _database = storeHandlers

  constructor() {
    super()
    // try {
    //   this._database = new SQLiteStorageDatabase()
    // } catch (err) {
    //   console.log('err ', err)
    // }
  }

  getProfile() {
    // return this._database.getProfile().then(result => {
    //   return Array.isArray(result) ? result[0] : result
    // })
    return this._database.getItem('__profile__')
  }

  setProfile(value: any) {
    // return this._database.setProfile(value)
    return this._database.setItem('__profile__', value)
  }
}
