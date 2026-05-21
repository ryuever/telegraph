import { describe, expect, it } from 'vitest'
import { DESIGN_BUILD_CHILD_PROFILES } from '../DesignBuildChildContracts'
import {
  DeterministicDesignBuildChildRunner,
  ModelBackedDesignBuildChildRunner,
} from '../DesignBuildChildRunner'

describe('DesignBuildChildRunner', () => {
  it('uses deterministic input when no model output is available', async () => {
    const runner = new DeterministicDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
    })).resolves.toEqual({
      output: { artifactId: 'artifact-1' },
      source: 'deterministic',
    })
  })

  it('uses model-backed stage output when provided', async () => {
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
      metadata: {
        designBuildModelChildOutputs: {
          [DESIGN_BUILD_CHILD_PROFILES.worker]: {
            'code-artifact': { artifactId: 'model-artifact' },
          },
        },
      },
    })).resolves.toEqual({
      output: { artifactId: 'model-artifact' },
      source: 'model-backed',
    })
  })
})
