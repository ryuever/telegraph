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
  | 'repair'
  | 'review-repair'

export interface DesignBuildChildRunRaw {
  contractVersion: typeof DESIGN_BUILD_CHILD_CONTRACT_VERSION
  profileId: DesignBuildChildProfileId
  stage: DesignBuildChildStage
  attempt?: number
}

export function childRunRaw(
  profileId: DesignBuildChildProfileId,
  stage: DesignBuildChildStage,
  options: { attempt?: number } = {},
): DesignBuildChildRunRaw {
  return {
    contractVersion: DESIGN_BUILD_CHILD_CONTRACT_VERSION,
    profileId,
    stage,
    attempt: options.attempt,
  }
}
