import { describe, expect, it } from 'vitest'
import { createDefaultDesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import {
  ShadcnRegistryIndexer,
  type ShadcnCliCommandRunner,
} from '../ShadcnRegistryIndexer'
import { RegistryTrustPolicy } from '../RegistryTrustPolicy'

describe('ShadcnRegistryIndexer', () => {
  it.each([
    ['登录页', ['login-01', 'button', 'input', 'card']],
    ['settings page', ['tabs', 'switch', 'input', 'button']],
    ['dashboard', ['card', 'table', 'badge', 'chart', 'sidebar']],
    ['pricing page', ['pricing-01', 'card', 'badge', 'button']],
    ['landing page', ['hero-01', 'button', 'card']],
  ])('retrieves official shadcn candidates for %s prompts', async (prompt, expectedNames) => {
    const ledger = await new ShadcnRegistryIndexer().retrieve({
      prompt,
      policy: createDefaultDesignSystemPolicy(),
    })

    const selectedNames = ledger.selected.map(candidate => candidate.name)
    for (const expectedName of expectedNames) {
      expect(selectedNames).toContain(expectedName)
    }
    expect(ledger.retrieval.status).toBe('degraded')
    expect(ledger.retrieval.degradedReason).toContain('deterministic official-catalog fallback')
    expect(ledger.selected.every(candidate => candidate.registry === '@shadcn')).toBe(true)
    expect(ledger.selected.every(candidate => candidate.reason.length > 0)).toBe(true)
    expect(ledger.trust.allowedRegistries).toContain('@shadcn')
    expect(ledger.retrieval.metrics.selectedCount).toBe(ledger.selected.length)
    expect(ledger.retrieval.metrics.fallbackRate).toBe(0)
  })

  it('supports shadcn search, docs, and view command retrieval through an injected runner', async () => {
    const runner = new CapturingRunner()
    const ledger = await new ShadcnRegistryIndexer({
      commandRunner: runner,
      limit: 4,
    }).retrieve({
      prompt: 'button',
      policy: createDefaultDesignSystemPolicy(),
    })

    expect(runner.calls).toEqual(expect.arrayContaining([
      ['search', '@shadcn', '-q', 'button', '-l', '4'],
      ['docs', 'button', '--json'],
      ['view', 'button'],
    ]))
    const button = ledger.selected.find(candidate => candidate.name === 'button')
    expect(button).toMatchObject({
      registry: '@shadcn',
      type: 'registry:ui',
    })
    expect(button?.dependencies).toContain('@radix-ui/react-slot')
    expect(button?.files).toContain('src/components/ui/button.tsx')
    expect(ledger.retrieval.sources.some(source => source.kind === 'shadcn-cli-search' && source.status === 'ok')).toBe(true)
  })

  it('rejects registry candidates that are not allowlisted', async () => {
    const ledger = await new ShadcnRegistryIndexer({
      commandRunner: new CommunityRunner(),
      limit: 4,
      trustPolicy: new RegistryTrustPolicy(),
    }).retrieve({
      prompt: 'community calendar',
      policy: createDefaultDesignSystemPolicy(),
    })

    expect(ledger.selected.every(candidate => candidate.registry === '@shadcn')).toBe(true)
    expect(ledger.rejected.some(candidate =>
      candidate.registry === 'https://community.example/registry' &&
      candidate.rejectionReason.includes('not allowlisted')
    )).toBe(true)
  })
})

class CapturingRunner implements ShadcnCliCommandRunner {
  readonly calls: string[][] = []

  run(args: string[]): Promise<{ stdout: string }> {
    this.calls.push(args)
    if (args[0] === 'search') {
      return Promise.resolve({
        stdout: JSON.stringify([
          {
            registry: '@shadcn',
            name: 'button',
            type: 'registry:ui',
            description: 'Button primitive',
            dependencies: ['class-variance-authority'],
            files: ['src/components/ui/button.tsx'],
          },
        ]),
      })
    }
    if (args[0] === 'docs') {
      return Promise.resolve({
        stdout: JSON.stringify({
          description: 'Button docs',
          dependencies: ['@radix-ui/react-slot'],
        }),
      })
    }
    return Promise.resolve({
      stdout: JSON.stringify({
        files: [
          {
            path: 'src/components/ui/button.tsx',
          },
        ],
      }),
    })
  }
}

class CommunityRunner implements ShadcnCliCommandRunner {
  run(args: string[]): Promise<{ stdout: string }> {
    if (args[0] === 'search') {
      return Promise.resolve({
        stdout: JSON.stringify([
          {
            registry: 'https://community.example/registry',
            name: 'calendar-plus',
            type: 'registry:ui',
            description: 'Community calendar',
          },
        ]),
      })
    }
    return Promise.resolve({ stdout: '{}' })
  }
}
