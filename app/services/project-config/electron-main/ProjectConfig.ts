import { injectable, createId } from '@x-oasis/di'
import ApplicationConfigBase from '../common/ApplicationConfigBase'

export const ApplicationConfigFactoryId = createId('application-config-factory')
export type IApplicationConfigFactory = (projectName: string) => ApplicationConfig

@injectable()
export default class ApplicationConfig extends ApplicationConfigBase {
  private _customizedLoadConfig = {}

  constructor(projectName: string) {
    super(projectName)
  }

  registerLoadConfig(config: { [key: string]: any }) {
    this._customizedLoadConfig = config
  }

  getLoadConfig() {
    return {
      ...this._customizedLoadConfig,
    }
  }
}
