import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = resolve(process.cwd(), '../..')
const SOURCE_ROOTS = [
  'apps/main/src',
  'apps/shared/src',
  'apps/daemon/src',
  'packages/services/src',
]

const FORBIDDEN_IMPORTS = [
  {
    code: 'agent_implementation_import',
    pattern: /from\s+['"]@\/packages\/agent(?!-protocol)(?:\/[^'"]*)?['"]/,
  },
  {
    code: 'agent_package_import',
    pattern: /from\s+['"]@telegraph\/agent(?:\/[^'"]*)?['"]/,
  },
  {
    code: 'orchestrator_core_import',
    pattern: /from\s+['"]@\/packages\/orchestrator-core(?:\/[^'"]*)?['"]/,
  },
  {
    code: 'orchestrator_core_package_import',
    pattern: /from\s+['"]@telegraph\/orchestrator-core(?:\/[^'"]*)?['"]/,
  },
]

describe('pagelet runtime boundary', () => {
  it('keeps runtime implementation imports out of main/shared/daemon/services source', async () => {
    const violations: Array<{ file: string; code: string }> = []

    for (const root of SOURCE_ROOTS) {
      const files = await listSourceFiles(resolve(REPO_ROOT, root))
      for (const file of files) {
        const source = await readFile(file, 'utf8')
        for (const forbidden of FORBIDDEN_IMPORTS) {
          if (forbidden.pattern.test(source)) {
            violations.push({ file: file.replace(`${REPO_ROOT}/`, ''), code: forbidden.code })
          }
        }
      }
    }

    expect(violations).toEqual([])
  })
})

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async entry => {
    const fullPath = resolve(dir, entry.name)
    if (entry.isDirectory()) return listSourceFiles(fullPath)
    if (/\.(ts|tsx)$/.test(entry.name)) return [fullPath]
    return []
  }))
  return nested.flat()
}
