import {
  BUILTIN_THEME_PACKS,
  getBuiltinThemePack,
  type ThemePack,
} from '@/apps/design/application/common/theme-pack-contract'

export class ThemePackRegistry {
  private readonly packs = new Map<string, ThemePack>()

  constructor(initialPacks: ThemePack[] = BUILTIN_THEME_PACKS) {
    for (const pack of initialPacks) {
      this.register(pack)
    }
  }

  register(pack: ThemePack): void {
    this.packs.set(pack.id, cloneThemePack(pack))
  }

  list(): ThemePack[] {
    return [...this.packs.values()].map(cloneThemePack)
  }

  get(id: string | undefined): ThemePack {
    return cloneThemePack(
      (id ? this.packs.get(id) : undefined) ??
      getBuiltinThemePack('shadcn-new-york-neutral') ??
      BUILTIN_THEME_PACKS[0],
    )
  }
}

function cloneThemePack(pack: ThemePack): ThemePack {
  return {
    ...pack,
    useCases: [...pack.useCases],
    tokens: {
      cssVariables: { ...pack.tokens.cssVariables },
      radius: pack.tokens.radius,
      typography: { ...pack.tokens.typography },
      spacingScale: [...pack.tokens.spacingScale],
    },
    layoutRules: [...pack.layoutRules],
    motionRules: [...pack.motionRules],
    examplePrompts: [...pack.examplePrompts],
    antiPatterns: [...pack.antiPatterns],
    reviewerChecks: pack.reviewerChecks.map(check => ({ ...check })),
  }
}
