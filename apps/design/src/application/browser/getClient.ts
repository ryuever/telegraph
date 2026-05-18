import {
  DESIGN_PAGELET_SERVICE_PATH,
  type IDesignPageletService,
} from '@/apps/design/application/common'
import { client } from '@/apps/main/application/browser/rpc-clients'

let cached: IDesignPageletService | null = null

export function getDesignPageletClient(): IDesignPageletService {
  if (!cached) {
    cached = client.getProxy(
      DESIGN_PAGELET_SERVICE_PATH
    ) as unknown as IDesignPageletService
  }
  return cached
}
