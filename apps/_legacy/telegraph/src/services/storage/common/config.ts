import { createId } from '@x-oasis/di'

export const servicePath = '/services/storage'
export const Handler = Symbol(servicePath)
export const StorageClient = createId('storage-client')

export type StorageService = {
  getProfile(): any
  setProfile(value: any): any
}
