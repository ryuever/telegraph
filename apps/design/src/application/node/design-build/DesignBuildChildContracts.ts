export const DESIGN_BUILD_CHILD_CONTRACT_VERSION = 'design-build-child-contract@0.1.0'

export const DESIGN_BUILD_CHILD_PROFILES = {
  planner: 'design-product-planner',
  scout: 'design-component-scout',
  worker: 'design-worker',
  reviewer: 'design-reviewer',
} as const

export type DesignBuildChildProfileId =
  typeof DESIGN_BUILD_CHILD_PROFILES[keyof typeof DESIGN_BUILD_CHILD_PROFILES]

export type DesignBuildChildStage =
  | 'intent-brief'
  | 'component-retrieval'
  | 'code-artifact'
  | 'review'

export interface DesignBuildChildProfile {
  id: DesignBuildChildProfileId
  title?: string
  description?: string
  systemPrompt: string
  tools?: string[]
  inheritSkills?: boolean
  skills?: string[]
  sourcePath?: string
  origin?: DesignBuildChildProfileOrigin
}

export interface DesignBuildChildProfileOrigin {
  extensionId: string
  contributionId: string
  fullId?: string
  sourceKind?: string
  sourcePath?: string
  rootPath?: string
}

export interface DesignBuildChildRunRaw {
  contractVersion: typeof DESIGN_BUILD_CHILD_CONTRACT_VERSION
  profileId: DesignBuildChildProfileId
  stage: DesignBuildChildStage
  attempt?: number
  profile?: {
    title?: string
    sourcePath?: string
    skills?: string[]
    origin?: unknown
  }
}

export function childRunRaw(
  profileId: DesignBuildChildProfileId,
  stage: DesignBuildChildStage,
  options: { attempt?: number; profile?: DesignBuildChildProfile } = {},
): DesignBuildChildRunRaw {
  return {
    contractVersion: DESIGN_BUILD_CHILD_CONTRACT_VERSION,
    profileId,
    stage,
    attempt: options.attempt,
    profile: options.profile
      ? {
          title: options.profile.title,
          sourcePath: options.profile.sourcePath,
          skills: options.profile.skills,
          origin: options.profile.origin,
        }
      : undefined,
  }
}
