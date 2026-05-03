import { injectable, createId } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'

export const ApplicationConfigId = createId('application-config')

@injectable()
export default class ApplicationConfigBase extends Disposable {
  private readonly _projectName: string

  constructor(projectName: string) {
    super()

    this._projectName = projectName
  }

  get projectName() {
    return this._projectName
  }
}
