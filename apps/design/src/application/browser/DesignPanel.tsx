import { useCallback, useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import type { DesignConfiguredModelDescriptorSnapshot } from '@/apps/design/application/common'
import { DesignRuntimeSettingsDialog } from './DesignRuntimeSettingsDialog'
import { DesignView } from './DesignView'
import { PageletDesignAgentService } from './pagelet-design-agent-service'
import {
  loadDesignRuntimeSettings,
  normalizeDesignRuntimeSettings,
  saveDesignRuntimeSettings,
  selectDesignRuntimeModel,
  type DesignRuntimeSettings,
} from './design-runtime-settings'

export function DesignPanel(): JSX.Element {
  const agent = useMemo(() => new PageletDesignAgentService(), [])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [runtimeSettings, setRuntimeSettings] = useState<DesignRuntimeSettings>(() =>
    loadDesignRuntimeSettings()
  )
  const [configuredModels, setConfiguredModels] = useState<DesignConfiguredModelDescriptorSnapshot[]>([])
  const [modelsLoading, setModelsLoading] = useState(true)

  const saveRuntimeSettings = useCallback((next: DesignRuntimeSettings): void => {
    const normalized = normalizeDesignRuntimeSettings(next)
    saveDesignRuntimeSettings(normalized)
    setRuntimeSettings(normalized)
  }, [])

  const selectModel = useCallback((provider: string, modelId: string): void => {
    setRuntimeSettings(current => {
      const next = selectDesignRuntimeModel(current, provider, modelId)
      saveDesignRuntimeSettings(next)
      return next
    })
  }, [])

  const refreshConfiguredModels = useCallback((signal?: AbortSignal): void => {
    setModelsLoading(true)
    void agent.listConfiguredModels(signal)
      .then(items => {
        if (signal?.aborted) return
        setConfiguredModels(items)
        setRuntimeSettings(loadDesignRuntimeSettings())
        setModelsLoading(false)
      })
      .catch(() => {
        if (!signal?.aborted) setModelsLoading(false)
      })
  }, [agent])

  useEffect(() => {
    const controller = new AbortController()
    refreshConfiguredModels(controller.signal)
    return () => { controller.abort() }
  }, [refreshConfiguredModels])

  useEffect(() => {
    const onFocus = (): void => { refreshConfiguredModels() }
    window.addEventListener('focus', onFocus)
    return () => { window.removeEventListener('focus', onFocus) }
  }, [refreshConfiguredModels])

  useEffect(() => {
    const onStorage = (): void => { refreshConfiguredModels() }
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'visible') refreshConfiguredModels()
    }
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [refreshConfiguredModels])

  useEffect(() => {
    if (configuredModels.length === 0) return
    const hasCurrent = configuredModels.some(model =>
      model.provider === runtimeSettings.provider && model.id === runtimeSettings.modelId
    )
    if (hasCurrent) return
    const fallback = configuredModels[0]
    selectModel(fallback.provider, fallback.id)
  }, [configuredModels, runtimeSettings.modelId, runtimeSettings.provider, selectModel])

  const selectedModelIsConfigured = configuredModels.some(model =>
    model.provider === runtimeSettings.provider && model.id === runtimeSettings.modelId
  )

  return (
    <div className="flex h-full bg-background text-foreground">
      <main className="min-w-0 flex-1 overflow-hidden">
        <DesignView
          onOpenSettings={() => { setSettingsOpen(true) }}
          configuredModels={configuredModels}
          selectedProvider={runtimeSettings.provider}
          selectedModelId={runtimeSettings.modelId}
          onModelSelect={selectModel}
          modelReady={selectedModelIsConfigured}
          modelsLoading={modelsLoading}
        />
      </main>
      <DesignRuntimeSettingsDialog
        open={settingsOpen}
        settings={runtimeSettings}
        onClose={() => { setSettingsOpen(false) }}
        onSave={saveRuntimeSettings}
      />
    </div>
  )
}
