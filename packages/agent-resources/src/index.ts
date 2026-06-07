export {
  DefaultAgentResourceLoader,
  discoverProjectContextFiles,
  type AgentResourceDiagnostic,
  type AgentResourceLoader,
  type AgentResourceSnapshot,
  type DefaultAgentResourceLoaderOptions,
  type LoadedContextFile,
  type ResourceExtensionPaths,
  type ResourcePathEntry,
  type ResourcePathMetadata,
  type ResourceSourceKind,
  type TextResource,
} from './resource-loader'

export {
  projectResourceContributionsToExtensionPaths,
  resourceExtensionPathsFromContributions,
  type AutoMaterializedResourceContributionKind,
  type ResourceContributionPathProjection,
} from './extension-contributions'

export {
  formatSelectedSkillBodiesForPrompt,
  formatSkillsForPrompt,
  loadSkills,
  loadSkillsFromDir,
  resolveSkillSearchRoot,
  type FormatSelectedSkillBodiesOptions,
  type LoadSkillsFromDirOptions,
  type LoadSkillsOptions,
} from './skills'

export type {
  LoadSkillsResult,
  Skill,
  SkillDiagnostic,
  SkillFrontmatter,
} from './skills'
