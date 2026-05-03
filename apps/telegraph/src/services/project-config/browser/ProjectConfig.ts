import { inject, injectable, createId } from '@x-oasis/di'
import { LocalizerId } from '@telegraph/services/localizer/common/Localizer'
import type Localizer from '@telegraph/services/localizer/common/Localizer'
import ApplicationConfigBase from '../common/ApplicationConfigBase'
import type { SidebarInfo } from './types'

export const ApplicationConfigFactoryId = createId('application-config-factory')
export type IApplicationConfigFactory = (projectName: string) => ApplicationConfig

@injectable()
export default class ApplicationConfig extends ApplicationConfigBase {
  private _customizedSidebarConfig = {} as Partial<SidebarInfo>

  constructor(
    projectName: string,
    @inject(LocalizerId) private localizer: Localizer
  ) {
    super(projectName)
  }

  registerSidebarConfig(config: Partial<SidebarInfo>) {
    this._customizedSidebarConfig = config
  }

  getRenderSidebarConfig(): SidebarInfo {
    return {
      order: 0,
      default: false,
      showOnMenu: true,
      projectName: this.projectName,
      label: this.localizer.resolve(this.projectName),
      ...this._customizedSidebarConfig,
    }
  }
}
