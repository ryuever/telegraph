/**
 * Model configuration types shared between main and renderer processes
 */

export interface EnvModelConfig {
  provider: string
  modelId: string
  apiKey: string
  baseUrl?: string
  label?: string
  isAvailable: boolean
}

export interface ModelEnvConfig {
  models: EnvModelConfig[]
  loadedFromEnv: boolean
}

export const GET_MODEL_CONFIG_CHANNEL = 'telegraph:model-config:get'
export const TEST_MODEL_CHANNEL = 'telegraph:model-config:test'
export const GET_AVAILABLE_MODELS_CHANNEL = 'telegraph:model-config:available'

export interface TestModelResult {
  provider: string
  modelId: string
  success: boolean
  error?: string
  latency?: number
}
