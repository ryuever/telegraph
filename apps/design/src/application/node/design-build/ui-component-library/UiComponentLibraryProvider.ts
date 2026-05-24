export type UiLibraryId = 'shadcn' | string

export interface UiComponentCatalogEntry {
  library: UiLibraryId
  name: string
  title: string
  category: string
  description: string
  docsUrl: string
  usageUrl: string
  aliases: string[]
}

export interface UiComponentUsage {
  library: UiLibraryId
  name: string
  title: string
  sourceUrl: string
  contentType: 'text/markdown'
  markdownContent: string
  truncated: boolean
  available: boolean
  error?: string
}

export interface UiComponentInstallFile {
  path: string
  content: string
  type?: string
}

export interface UiComponentInstallPlan {
  library: UiLibraryId
  name: string
  sourceUrl: string
  dependencies: string[]
  registryDependencies: string[]
  installedComponentNames: string[]
  files: UiComponentInstallFile[]
}

export interface UiComponentLibraryProvider {
  readonly library: UiLibraryId
  listComponents(): Promise<UiComponentCatalogEntry[]>
  getComponentUsages(componentNames: string[]): Promise<UiComponentUsage[]>
  installComponent(componentName: string): Promise<UiComponentInstallPlan>
  normalizeComponentName(componentName: string): string
}
