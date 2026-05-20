import type {
  AgentContribution,
  ContextProviderContribution,
  HarnessExtensionSourceKind,
  OrchestrationToolContribution,
  ToolContribution,
} from './HarnessExtensionManifest'

export interface ContributionOrigin {
  extensionId: string
  contributionId: string
  fullId: string
  sourceKind: HarnessExtensionSourceKind
  sourcePath?: string
  rootPath?: string
}

export interface ResolvedAgentContribution extends AgentContribution {
  alias: string
  fullId: string
  promptPath?: string
  origin: ContributionOrigin
}

export interface ResolvedToolContribution extends ToolContribution {
  fullId: string
  origin: ContributionOrigin
}

export interface ResolvedOrchestrationToolContribution extends OrchestrationToolContribution {
  fullId: string
  origin: ContributionOrigin
}

export interface ResolvedContextProviderContribution extends ContextProviderContribution {
  fullId: string
  origin: ContributionOrigin
}

export interface HarnessContributionSnapshot {
  agents: ResolvedAgentContribution[]
  tools: ResolvedToolContribution[]
  orchestrationTools: ResolvedOrchestrationToolContribution[]
  contextProviders: ResolvedContextProviderContribution[]
  createdAt: number
}

export function agentAliasList(snapshot: HarnessContributionSnapshot): string[] {
  return snapshot.agents.map(agent => agent.alias)
}

export function agentCatalogText(snapshot: HarnessContributionSnapshot): string {
  if (snapshot.agents.length === 0) {
    return 'No subagent profiles are currently available.'
  }
  return snapshot.agents
    .map(agent => `- ${agent.alias}: ${agent.description} (from ${agent.origin.extensionId})`)
    .join('\n')
}
