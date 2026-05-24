export type DesignExportFormat = 'html-zip' | 'pdf' | 'pptx' | 'png-screenshots'

export interface DesignExportEntry {
  format: DesignExportFormat
  path?: string
  mediaType?: string
  status: 'planned' | 'generated' | 'failed'
  error?: string
}

export interface DesignExportArtifact {
  id: string
  kind: 'design-export'
  title: string
  sourceArtifactId: string
  sourceProjectRoot?: string
  formats: DesignExportFormat[]
  themePackId?: string
  exports: DesignExportEntry[]
  manifestPath: string
  createdAt: number
  metadata?: Record<string, unknown>
}

export interface DesignArtifactExportRequest {
  runId: string
  sessionId?: string
  artifactId: string
  artifact: unknown
  formats: DesignExportFormat[]
}

export interface DesignArtifactExportResult {
  runId: string
  artifactId: string
  status: 'exported' | 'failed'
  artifact?: DesignExportArtifact
  error?: string
}

export interface DesignExportablePatchArtifact {
  id: string
  kind: string
  title?: string
  revision?: number
  metadata?: Record<string, unknown>
  operations: Array<{
    path: string
    kind: 'add' | 'update' | 'delete'
    content?: string
    expectedOriginal?: string
  }>
}
