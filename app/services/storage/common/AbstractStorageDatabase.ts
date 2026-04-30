import { Disposable } from '@x-oasis/disposable'

abstract class AbstractStorageDatabase extends Disposable {
  abstract doConnect(): void

  abstract getItem(): void

  abstract setItem(): void
}

export default AbstractStorageDatabase
