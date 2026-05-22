import { createId } from '@x-oasis/di'

export const CLI_GATEWAY_PARTICIPANT_ID = 'cli-gateway'

export interface ICliGatewayApplication {
  start(): Promise<void>
}

export const CliGatewayApplicationId = createId('CliGatewayApplication')
