import { createId, inject, injectable } from '@x-oasis/di'
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker'
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker'
import type { ISharedService } from '@/apps/shared/application/common'
import { RunBrokerSocketGateway } from '@/apps/shared/application/node/RunBrokerSocketGateway'
import { createLogger } from '@/packages/services/log/node/logger'
import type { RunProjectionRecord } from '@/packages/run-protocol'

const logger = createLogger('cli-gateway')

export const CliGatewayWorkerId = createId('CliGatewayWorker')

@injectable()
export class CliGatewayWorker extends PageletWorker<ISharedService> {
  private readonly gateway = new RunBrokerSocketGateway(this.shared, undefined, {
    openRun: params => this.openRun(params),
  })
  private startPromise: Promise<void> | null = null

  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config)
  }

  protected override onSharedClientReady(): void {
    void this.startGateway()
  }

  private async startGateway(): Promise<void> {
    if (this.startPromise) return this.startPromise
    this.startPromise = this.gateway.start()
      .then(path => {
        logger.info(`[cli-gateway] run broker gateway listening on ${path}`)
      })
      .catch((error: unknown) => {
        this.startPromise = null
        logger.warn(`[cli-gateway] run broker gateway failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`)
      })
    return this.startPromise
  }

  private async openRun(params: unknown): Promise<OpenRunResult> {
    const input = parseOpenRunParams(params)
    const projection = await this.shared.getRunProjection(input.runId)
    if (!projection) {
      throw new Error(`Run projection not found: ${input.runId}`)
    }

    const result = await this.main.openRun(input.runId, {
      pageletId: projection.pageletId,
    })
    if (typeof result === 'string') {
      throw new Error(result)
    }

    return {
      ...result,
      projection,
    }
  }
}

interface OpenRunInput {
  runId: string
}

interface OpenRunResult {
  runId: string
  pageletId?: string
  pageId: string
  focused: boolean
  projection: RunProjectionRecord
}

function parseOpenRunParams(params: unknown): OpenRunInput {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new Error('openRun requires params object')
  }
  const runId = (params as { runId?: unknown }).runId
  if (typeof runId !== 'string' || runId.length === 0) {
    throw new Error('openRun requires runId')
  }
  return { runId }
}
