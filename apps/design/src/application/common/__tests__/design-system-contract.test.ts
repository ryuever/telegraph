import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DESIGN_SYSTEM_POLICY_ID,
  createDefaultDesignSystemPolicy,
  resolveDesignSystemPolicy,
} from '../design-system-contract'

describe('design-system-contract', () => {
  it('creates the default shadcn-first standalone policy', () => {
    const policy = createDefaultDesignSystemPolicy()

    expect(policy).toMatchObject({
      id: DEFAULT_DESIGN_SYSTEM_POLICY_ID,
      mode: 'standalone-preview',
      uiLibrary: {
        handwritePolicy: 'only-when-unavailable',
      },
      packagePolicy: {
        requireDependencyClosure: true,
      },
      aliasPolicy: {
        importAlias: '@',
        sourceRoot: 'src',
        requireViteAlias: true,
        requireTsconfigAlias: true,
      },
    })
    expect(policy.uiLibrary.allowedRegistries.map(registry => registry.id)).toEqual(['@shadcn'])
    expect(policy.packagePolicy.allowedDependencies).toContain('class-variance-authority')
    expect(policy.tokenPolicy.requiredTokens).toContain('--primary')
  })

  it('resolves optional metadata overrides without losing default policy constraints', () => {
    const policy = resolveDesignSystemPolicy({
      designContext: {
        designSystem: {
          id: 'workspace-apply-shadcn',
          mode: 'workspace-apply',
          themePack: {
            id: 'studio-dark',
            label: 'Studio Dark',
            source: 'project',
          },
        },
      },
    })

    expect(policy).toMatchObject({
      id: 'workspace-apply-shadcn',
      mode: 'workspace-apply',
      themePack: {
        id: 'studio-dark',
        label: 'Studio Dark',
        source: 'project',
      },
    })
    expect(policy.uiLibrary.allowedRegistries.map(registry => registry.id)).toEqual(['@shadcn'])
    expect(policy.packagePolicy.requireDependencyClosure).toBe(true)
  })

  it('resolves built-in theme pack ids from metadata', () => {
    const policy = resolveDesignSystemPolicy({
      designSystem: {
        themePackId: 'studio-dark',
      },
    })

    expect(policy.themePack).toEqual({
      id: 'studio-dark',
      label: 'Studio Dark',
      source: 'built-in',
    })
  })
})
