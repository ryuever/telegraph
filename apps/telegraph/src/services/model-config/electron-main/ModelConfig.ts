import { ipcMain } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as https from 'https'
import { app } from 'electron'
import {
  GET_MODEL_CONFIG_CHANNEL,
  TEST_MODEL_CHANNEL,
  GET_AVAILABLE_MODELS_CHANNEL,
  type EnvModelConfig,
  type ModelEnvConfig,
  type TestModelResult,
} from '../common/types'

// Supported model providers and their env variable patterns
const MODEL_ENV_PATTERNS = [
  // MiniMax CN
  { provider: 'minimax-cn', modelId: 'MiniMax-M2.7', envKey: 'MINIMAX_CN_API_KEY', baseUrlEnvKey: 'MINIMAX_CN_BASE_URL' },
  { provider: 'minimax-cn', modelId: 'MiniMax-M2.7-highspeed', envKey: 'MINIMAX_CN_API_KEY', baseUrlEnvKey: 'MINIMAX_CN_BASE_URL' },
  // MiniMax (International)
  { provider: 'minimax', modelId: 'MiniMax-M2.7', envKey: 'MINIMAX_API_KEY', baseUrlEnvKey: 'MINIMAX_BASE_URL' },
  { provider: 'minimax', modelId: 'MiniMax-M2.7-highspeed', envKey: 'MINIMAX_API_KEY', baseUrlEnvKey: 'MINIMAX_BASE_URL' },
  // Anthropic
  { provider: 'anthropic', modelId: 'claude-sonnet-4.5', envKey: 'ANTHROPIC_API_KEY', baseUrlEnvKey: 'ANTHROPIC_BASE_URL' },
  // OpenAI
  { provider: 'openai', modelId: 'gpt-4o', envKey: 'OPENAI_API_KEY', baseUrlEnvKey: 'OPENAI_BASE_URL' },
  { provider: 'openai', modelId: 'gpt-4o-mini', envKey: 'OPENAI_API_KEY', baseUrlEnvKey: 'OPENAI_BASE_URL' },
  // OpenAI Compatible
  { provider: 'minimax-openai-compat', modelId: 'MiniMax-Text-01', envKey: 'OPENAI_COMPAT_API_KEY', baseUrlEnvKey: 'OPENAI_COMPAT_BASE_URL' },
]

const DEFAULT_BASE_URLS: Record<string, string> = {
  'minimax-cn': 'https://api.minimaxi.com',
  'minimax': 'https://api.minimax.com',
  'anthropic': 'https://api.anthropic.com',
  'openai': 'https://api.openai.com',
  'minimax-openai-compat': 'https://api.minimaxi.com/v1',
}

let cachedEnvConfig: ModelEnvConfig | null = null

function findEnvFile(): string | null {
  const possiblePaths = [
    // App root (for development)
    path.join(process.cwd(), '.env'),
    // User data directory (for production)
    path.join(app.getPath('userData'), '.env'),
    // App directory
    path.join(app.getAppPath(), '.env'),
  ]

  for (const envPath of possiblePaths) {
    if (fs.existsSync(envPath)) {
      console.log('[ModelConfig] Found .env at:', envPath)
      return envPath
    }
  }
  return null
}

function parseEnvFile(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8')
  const env: Record<string, string> = {}

  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    // Skip comments and empty lines
    if (!trimmed || trimmed.startsWith('#')) continue

    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue

    const key = trimmed.slice(0, eqIndex).trim()
    let value = trimmed.slice(eqIndex + 1).trim()

    // Remove quotes if present
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }

    env[key] = value
  }

  return env
}

function loadEnvConfig(): ModelEnvConfig {
  if (cachedEnvConfig) return cachedEnvConfig

  const envPath = findEnvFile()
  const envVars = envPath ? parseEnvFile(envPath) : {}

  const models: EnvModelConfig[] = []

  for (const pattern of MODEL_ENV_PATTERNS) {
    const apiKey = envVars[pattern.envKey]
    if (apiKey) {
      const baseUrl = envVars[pattern.baseUrlEnvKey] || DEFAULT_BASE_URLS[pattern.provider]
      models.push({
        provider: pattern.provider,
        modelId: pattern.modelId,
        apiKey,
        baseUrl,
        label: `${pattern.provider} · ${pattern.modelId}`,
        isAvailable: true,
      })
    }
  }

  cachedEnvConfig = {
    models,
    loadedFromEnv: models.length > 0,
  }

  console.log('[ModelConfig] Loaded', models.length, 'models from .env')
  return cachedEnvConfig
}

interface TestConfig {
  provider: string
  modelId: string
  apiKey: string
  baseUrl?: string
}

async function testModelConnection(config: TestConfig): Promise<TestModelResult> {
  const startTime = Date.now()

  return new Promise((resolve) => {
    try {
      // Simple connection test - make a lightweight request to verify the key works
      let testPath: string
      const baseUrl = config.baseUrl || DEFAULT_BASE_URLS[config.provider] || 'https://api.minimaxi.com'
      const url = new URL(baseUrl)

      // Provider-specific test endpoints
      switch (config.provider) {
        case 'minimax':
        case 'minimax-cn':
          testPath = '/v1/models'
          break
        case 'anthropic':
          testPath = '/v1/models'
          break
        case 'openai':
          testPath = '/v1/models'
          break
        case 'minimax-openai-compat':
          testPath = '/models'
          break
        default:
          testPath = '/v1/models'
      }

      const options: https.RequestOptions = {
        hostname: url.hostname,
        port: url.port || 443,
        path: testPath,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 10000,
      }

      const req = https.request(options, (res) => {
        const statusCode = res.statusCode || 0

        if (statusCode >= 200 && statusCode < 300) {
          resolve({
            provider: config.provider,
            modelId: config.modelId,
            success: true,
            latency: Date.now() - startTime,
          })
        } else {
          let data = ''
          res.on('data', chunk => data += chunk)
          res.on('end', () => {
            resolve({
              provider: config.provider,
              modelId: config.modelId,
              success: false,
              error: `HTTP ${statusCode}: ${data}`,
            })
          })
        }
      })

      req.on('error', (error) => {
        resolve({
          provider: config.provider,
          modelId: config.modelId,
          success: false,
          error: error.message,
        })
      })

      req.on('timeout', () => {
        req.destroy()
        resolve({
          provider: config.provider,
          modelId: config.modelId,
          success: false,
          error: 'Connection timeout',
        })
      })

      req.end()
    } catch (error) {
      resolve({
        provider: config.provider,
        modelId: config.modelId,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })
}

export function setupModelConfigHandler() {
  // Handler to get all model configurations from .env
  ipcMain.handle(GET_MODEL_CONFIG_CHANNEL, async (): Promise<ModelEnvConfig> => {
    return loadEnvConfig()
  })

  // Handler to get available models (with valid API keys)
  ipcMain.handle(GET_AVAILABLE_MODELS_CHANNEL, async (): Promise<EnvModelConfig[]> => {
    const config = loadEnvConfig()
    return config.models
  })

  // Handler to test a specific model connection
  ipcMain.handle(TEST_MODEL_CHANNEL, async (_, config: TestConfig): Promise<TestModelResult> => {
    return testModelConnection(config)
  })

  console.log('[ModelConfig] Handler registered')
}

// Also expose for programmatic use in main process
export function getModelEnvConfig(): ModelEnvConfig {
  return loadEnvConfig()
}

export function clearModelConfigCache() {
  cachedEnvConfig = null
}
