import { Container } from '@x-oasis/di'
import { TELEGRAPH_AMD_ENTRY } from '@app/core/node/process/env'

import PageletProcessModule from './PageletProcessModule'
import { PageletProcessNodeId } from './PageletProcessNode'
import type { InitApplicationInPagelet } from '../common/types'

const container = new Container()

container.load(PageletProcessModule)

const pageletProcessNode = container.get(PageletProcessNodeId)
pageletProcessNode.start()

if (process.env[TELEGRAPH_AMD_ENTRY]) {
  import(process.env[TELEGRAPH_AMD_ENTRY]).then(module => {
    const { initApplication } = module.default as {
      initApplication: InitApplicationInPagelet
    }
    initApplication?.(container, pageletProcessNode.getServiceHost())
  })
}

export { container }
