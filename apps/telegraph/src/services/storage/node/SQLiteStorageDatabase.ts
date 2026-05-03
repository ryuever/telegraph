import Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { urlPath } from '@drizzle/drizzle.config'

import { profile } from '@drizzle/schema'
import { eq } from 'drizzle-orm'
import type { LoginInfo } from '@telegraph/services/account/electron-main/types'
import AbstractStorageDatabase from '../common/AbstractStorageDatabase'

export default class SQLiteStorageDatabase extends AbstractStorageDatabase {
  private _db: BetterSQLite3Database

  constructor() {
    super()
    this.doConnect()
  }

  doConnect(): void {
    try {
      const sqlite = new Database(urlPath)
      this._db = drizzle(sqlite)
    } catch (err) {
      console.log('db err ', err)
    }
  }

  getItem() {}

  setItem(): void {}

  getProfile() {
    const result = this._db.select().from(profile).where(eq(profile.isCurrent, true))
    return result
  }

  setProfile(userProfile: LoginInfo) {
    // if (userProfile && userProfile.userId) this._db.update(profile).set(userProfile).where(eq(profile.userId, userProfile.userId)).run()
    if (userProfile && userProfile.userId) {
      this._db
        .insert(profile)
        .values(userProfile)
        .onConflictDoUpdate({ target: profile.userId, set: userProfile })
        .run()
    }
  }
}
