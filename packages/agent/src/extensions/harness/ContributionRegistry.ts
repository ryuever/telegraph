import type {
  AgentContribution,
  HarnessExtensionManifest,
  HarnessExtensionPackage,
  HarnessExtensionSourceKind,
} from './HarnessExtensionManifest'
import type {
  ContributionOrigin,
  HarnessContributionSnapshot,
  ResolvedAgentContribution,
  ResolvedContextProviderContribution,
  ResolvedOrchestrationToolContribution,
  ResolvedToolContribution,
} from './HarnessContributionSnapshot'

const SOURCE_PRIORITY: Record<HarnessExtensionSourceKind, number> = {
  builtin: 0,
  user: 1,
  workspace: 2,
  run: 3,
}

export class ContributionRegistry {
  private readonly packages: HarnessExtensionPackage[] = []

  registerPackage(pkg: HarnessExtensionPackage): void {
    this.packages.push(pkg)
  }

  registerManifest(
    manifest: HarnessExtensionManifest,
    options: { rootPath?: string; sourceKind: HarnessExtensionSourceKind },
  ): void {
    this.registerPackage({
      manifest,
      rootPath: options.rootPath,
      sourceKind: options.sourceKind,
    })
  }

  createSnapshot(): HarnessContributionSnapshot {
    const agentsByAlias = new Map<string, ResolvedAgentContribution>()
    const tools: ResolvedToolContribution[] = []
    const orchestrationTools: ResolvedOrchestrationToolContribution[] = []
    const contextProviders: ResolvedContextProviderContribution[] = []

    for (const pkg of sortedPackages(this.packages)) {
      const manifest = pkg.manifest
      for (const agent of manifest.contributes?.agents ?? []) {
        const resolved = resolveAgentContribution(agent, pkg)
        const existing = agentsByAlias.get(resolved.alias)
        if (!existing || shouldReplace(existing, resolved)) {
          agentsByAlias.set(resolved.alias, resolved)
        }
      }

      for (const tool of manifest.contributes?.tools ?? []) {
        tools.push({
          ...tool,
          fullId: fullContributionId(manifest.id, tool.id),
          origin: originFor(pkg, tool.id),
        })
      }

      for (const tool of manifest.contributes?.orchestrationTools ?? []) {
        orchestrationTools.push({
          ...tool,
          fullId: fullContributionId(manifest.id, tool.id),
          origin: originFor(pkg, tool.id),
        })
      }

      for (const provider of manifest.contributes?.contextProviders ?? []) {
        contextProviders.push({
          ...provider,
          fullId: fullContributionId(manifest.id, provider.id),
          origin: originFor(pkg, provider.id),
        })
      }
    }

    return {
      agents: [...agentsByAlias.values()],
      tools,
      orchestrationTools,
      contextProviders,
      createdAt: Date.now(),
    }
  }
}

function resolveAgentContribution(
  agent: AgentContribution,
  pkg: HarnessExtensionPackage,
): ResolvedAgentContribution {
  const alias = agent.id
  const fullId = fullContributionId(pkg.manifest.id, agent.id)
  const promptPath = pkg.rootPath && !isUri(agent.prompt)
    ? joinPath(pkg.rootPath, agent.prompt)
    : undefined
  return {
    ...agent,
    alias,
    fullId,
    promptPath,
    origin: originFor(pkg, agent.id, promptPath),
  }
}

function sortedPackages(packages: HarnessExtensionPackage[]): HarnessExtensionPackage[] {
  return [...packages].sort((a, b) => SOURCE_PRIORITY[a.sourceKind] - SOURCE_PRIORITY[b.sourceKind])
}

function shouldReplace(existing: ResolvedAgentContribution, next: ResolvedAgentContribution): boolean {
  if (next.replaces === existing.fullId || next.replaces === existing.alias) {
    return true
  }
  return SOURCE_PRIORITY[next.origin.sourceKind] >= SOURCE_PRIORITY[existing.origin.sourceKind]
}

function originFor(
  pkg: HarnessExtensionPackage,
  contributionId: string,
  sourcePath?: string,
): ContributionOrigin {
  return {
    extensionId: pkg.manifest.id,
    contributionId,
    fullId: fullContributionId(pkg.manifest.id, contributionId),
    sourceKind: pkg.sourceKind,
    sourcePath,
    rootPath: pkg.rootPath,
  }
}

function fullContributionId(extensionId: string, contributionId: string): string {
  return `${extensionId}/${contributionId}`
}

function isUri(value: string): boolean {
  return /^[a-z][a-z0-9+.-]*:/i.test(value)
}

function joinPath(root: string, path: string): string {
  return `${root.replace(/[/\\]$/, '')}/${path.replace(/^\.?[/\\]/, '')}`
}
