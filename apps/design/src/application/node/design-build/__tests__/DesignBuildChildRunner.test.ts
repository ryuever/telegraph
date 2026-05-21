import { describe, expect, it } from 'vitest'
import { DESIGN_BUILD_CHILD_PROFILES } from '../DesignBuildChildContracts'
import { ModelBackedDesignBuildChildRunner } from '../DesignBuildChildRunner'

describe('DesignBuildChildRunner', () => {
  it('fails when model settings are missing instead of falling back to deterministic output', async () => {
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
    })).rejects.toThrow('Design build model settings are required')
  })
})
