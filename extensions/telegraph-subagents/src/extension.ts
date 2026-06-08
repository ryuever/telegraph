/**
 * Command-style entry point for the `@telegraph/subagents` extension (D-016 P5).
 *
 * This factory is loaded by `ExtensionHost` (from `@/packages/agent-extensions`).
 * It performs three things imperatively against the `TelegraphExtensionHost`
 * passed in via context:
 *
 *  1. Discover subagent definitions from the three configured scopes
 *     (builtin / user / project) and register each as a protocol-level
 *     `SubagentProfile` so any consumer that calls
 *     `host.listSubagentProfiles()` sees the catalog.
 *
 *  2. Construct an extension-owned `SubagentManager` and expose it as a
 *     custom capability under the well-known key
 *     {@link TELEGRAPH_SUBAGENTS_MANAGER_KEY} so the hosting pagelet can
 *     subscribe to lifecycle events (`subagent_progress` stream).
 *
 *  3. Register the `telegraph-subagents` runtime contribution; its `create`
 *     factory builds a fresh `TelegraphSubagentHarness` bound to that
 *     manager. The harness's `RuntimeExecutor` shape is preserved verbatim
 *     so existing `AgentHarness` wiring keeps working with parity.
 *
 * The factory returns a cleanup function that drops the runtime / profile
 * registrations are intentionally *not* unwound — the `CapabilityHost`
 * registries are owned by the pagelet lifetime, and the pagelet disposes the
 * whole host on shutdown. The cleanup only releases the `SubagentManager`'s
 * own resources (in-flight controllers) so the extension can be deactivated
 * cleanly during a reload.
 *
 * See RFC §7 P5 ("Full port with parity") and `agentDiscovery.ts` for the
 * underlying discovery semantics.
 */

import type { SubagentProfile } from '@/packages/agent-protocol'
import type {
  AgentCapability,
  AgentCapabilityContext,
} from '@/packages/agent-capabilities'
import { TELEGRAPH_SUBAGENTS_RUNTIME_ID } from './constants'
import { discoverAgents } from './agentDiscovery'
import { SubagentManager } from './SubagentManager'
import { TelegraphSubagentHarness } from './TelegraphSubagentHarness'
import type { SubagentDefinition } from './types'

/**
 * Custom-capability key under which the extension publishes its
 * `SubagentManager` instance. Pagelets subscribe to it via
 * `host.getCustom(TELEGRAPH_SUBAGENTS_MANAGER_KEY)`.
 */
export const TELEGRAPH_SUBAGENTS_MANAGER_KEY = 'telegraph-subagents.manager'

const RUNTIME_LABEL = 'Telegraph Native Subagents'

const extension: AgentCapability = (context: AgentCapabilityContext) => {
  const { host } = context

  const manager = new SubagentManager()
  host.registerCustom(TELEGRAPH_SUBAGENTS_MANAGER_KEY, manager)

  // Discovery is intentionally eager so `host.listSubagentProfiles()` is
  // populated before the first run. Per-run snapshots inside the harness
  // still go through `createTelegraphSubagentsSnapshot` for freshness; this
  // registration is for catalog/UI consumers.
  const definitions = discoverAgents({ cwd: process.cwd() })
  for (const definition of definitions.values()) {
    host.registerSubagentProfile(subagentProfileFromDefinition(definition))
  }

  host.registerRuntime({
    id: TELEGRAPH_SUBAGENTS_RUNTIME_ID,
    label: RUNTIME_LABEL,
    create: () => new TelegraphSubagentHarness({ subagentManager: manager }),
  })

  // Cleanup: release manager-owned controllers; leave the host registries
  // intact (they are tied to the pagelet's lifetime, not the extension's).
  return () => {
    manager.disposeAll()
  }
}

export default extension

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Project the harness-internal `SubagentDefinition` (rich, parser-shaped)
 * down to the protocol-level `SubagentProfile` (the LLM/router-facing
 * contract). Fields without a profile equivalent are stashed in
 * `metadata` so debug surfaces can recover them.
 */
function subagentProfileFromDefinition(definition: SubagentDefinition): SubagentProfile {
  return {
    name: profileNameFor(definition),
    description: definition.description ?? `${definition.name} subagent profile`,
    systemPrompt: definition.systemPrompt,
    allowedTools: definition.tools,
    metadata: {
      title: definition.title,
      scope: definition.scope,
      package: definition.package,
      model: definition.model,
      fallbackModels: definition.fallbackModels,
      thinking: definition.thinking,
      systemPromptMode: definition.systemPromptMode,
      inheritProjectContext: definition.inheritProjectContext,
      inheritSkills: definition.inheritSkills,
      defaultContext: definition.defaultContext,
      output: definition.output,
      defaultReads: definition.defaultReads,
      defaultProgress: definition.defaultProgress,
      skills: definition.skills,
      sourcePath: definition.sourcePath,
      origin: definition.origin,
    },
  }
}

function profileNameFor(definition: SubagentDefinition): string {
  return definition.package ? `${definition.package}.${definition.name}` : definition.name
}
