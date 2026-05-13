import { createId, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'

import type { Configuration } from './types'

export const LocalizerId = createId('localizer')

@injectable()
export default class Localizer extends Disposable {
  private _config: Configuration

  load(config: Configuration) {
    this._config = config
  }

  resolve(key: string) {
    return this._config[key]
  }
}
