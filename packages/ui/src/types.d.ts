// Type declarations for @telegraph/ui

// Model configuration types
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

export interface TestModelResult {
  provider: string
  modelId: string
  success: boolean
  error?: string
  latency?: number
}

export interface ModelConnectionStatus {
  provider: string
  modelId: string
  connected: boolean
  latency?: number
  error?: string
}

// Extend the global window interface
declare global {
  interface TelegraphGlobals {
    ipcRenderer: {
      send(channel: string, ...args: any[]): void
      invoke(channel: string, ...args: any[]): Promise<any>
      on(channel: string, listener: (event: any, ...args: any[]) => void): void
      once(channel: string, listener: (event: any, ...args: any[]) => void): void
      removeListener(channel: string, listener: (event: any, ...args: any[]) => void): void
    }
    webFrame: {
      setZoomLevel(level: number): void
    }
    modelConfig: {
      getConfig(): Promise<ModelEnvConfig>
      getAvailableModels(): Promise<EnvModelConfig[]>
      testModel(config: { provider: string; modelId: string; apiKey: string; baseUrl?: string }): Promise<TestModelResult>
    }
  }

  interface Window {
    telegraph: TelegraphGlobals
  }
}

export {}
