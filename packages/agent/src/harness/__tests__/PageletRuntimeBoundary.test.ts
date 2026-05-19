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
    pattern: importSpecifierPattern('@/packages/agent', '(?!-protocol)'),
  },
  {
    code: 'agent_package_import',
    pattern: importSpecifierPattern('@telegraph/agent'),
  },
  {
    code: 'orchestrator_core_import',
    pattern: importSpecifierPattern('@/packages/orchestrator-core'),
  },
  {
    code: 'orchestrator_core_package_import',
    pattern: importSpecifierPattern('@telegraph/orchestrator-core'),
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

  it('detects static, side-effect, dynamic, and require boundary imports', () => {
    const source = [
      'import type { AgentRuntime } from "@/packages/agent/runtime/AgentRuntime"',
      'import "@/packages/agent/extensions/node"',
      'const runtime = await import("@telegraph/agent/runtime/createRuntime")',
      'const core = require("@/packages/orchestrator-core")',
      'import type { AgentEvent } from "@/packages/agent-protocol"',
    ].join('\n')

    expect(findForbiddenImports(source).map(item => item.code)).toEqual([
      'agent_implementation_import',
      'agent_implementation_import',
      'agent_package_import',
      'orchestrator_core_import',
    ])
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

function findForbiddenImports(source: string): Array<{ code: string }> {
  const matches: Array<{ code: string }> = []
  for (const forbidden of FORBIDDEN_IMPORTS) {
    const flags = forbidden.pattern.flags.includes('g')
      ? forbidden.pattern.flags
      : `${forbidden.pattern.flags}g`
    const pattern = new RegExp(forbidden.pattern.source, flags)
    for (const _match of source.matchAll(pattern)) {
      matches.push({ code: forbidden.code })
    }
  }
  return matches
}

function importSpecifierPattern(packageName: string, suffixGuard = ''): RegExp {
  const escaped = escapeRegExp(packageName)
  return new RegExp(
    `(?:from\\s+|import\\s*\\(\\s*|require\\s*\\(\\s*|import\\s+)['"]${escaped}${suffixGuard}(?:\\/[^'"]*)?['"]`,
  )
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
