import { createId } from '@x-oasis/di'
import type { BrowserViewConfig } from './types'

export const ProjectRegistryId = createId('project-registry')

export abstract class Projects {
  abstract getLoadConfigs(): BrowserViewConfig[]
}
