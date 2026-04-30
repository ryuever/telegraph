import { REDCITY_PROCESS_ID } from '@app/core/node/process/env'
import Store from 'electron-store'

let _store: Store

export const getStore = () => {
  if (!_store) {
    _store = new Store({
      name: `${process.env[REDCITY_PROCESS_ID]}-redim-config`,
      // prod need
      projectName: 'redim',
    })
  }
  return _store
}

export { Store }

export const storeHandlers = {
  setItem: async (key: string, value: any) => {
    const store = getStore()
    store.set(key, value)
  },

  getItem: async (key: string) => {
    const store = getStore()
    return store.get(key)
  },

  removeItem: async (key: string) => {
    const store = getStore()
    return store.delete(key)
  },
}
