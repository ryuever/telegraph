import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  encodeTelegraphWorkspaceSegment,
  resolveTelegraphDataDir,
  resolveTelegraphWorkspaceRoot,
} from '../telegraphPaths'

const monorepoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../../..')

describe('telegraphPaths', () => {
  it('resolves the monorepo root from apps/main cwd', () => {
    const appsMain = join(monorepoRoot, 'apps', 'main')
    const workspaceRoot = resolveTelegraphWorkspaceRoot(appsMain)
    expect(workspaceRoot).toBe(monorepoRoot)
    expect(resolveTelegraphDataDir(appsMain)).toBe(join(monorepoRoot, '.telegraph'))
  })

  it('encodes workspace paths like pi session directories', () => {
    expect(encodeTelegraphWorkspaceSegment('/Users/dev/telegraph')).toBe(
      '--Users-dev-telegraph--',
    )
  })
})
