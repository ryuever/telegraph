/**
 * Handoff utilities for multi-agent swarm.
 *
 * A "handoff" is a mechanism for one agent to transfer control to another.
 * In the orchestrator engine, this is implemented as a node action that
 * returns a Command({ goto, update }) targeting the parent graph.
 *
 * Since the orchestrator is a standalone engine (no LLM tool abstraction),
 * handoffs are represented as plain node actions that can be invoked
 * directly within an agent's subgraph.
 */

import { Command } from "../constants.js";

/** Metadata key used to tag handoff destinations on agent nodes. */
export const METADATA_KEY_HANDOFF_DESTINATION = "__handoff_destination";

/**
 * Normalize an agent name for use in identifiers.
 */
function normalizeAgentName(agentName: string): string {
  return agentName.trim().replace(/\s+/g, "_").toLowerCase();
}

/**
 * Parameters for creating a handoff action.
 */
export interface CreateHandoffParams {
  /**
   * The name of the agent to hand off control to.
   * Must match the name used when adding the agent to the swarm.
   */
  agentName: string;

  /**
   * Optional description for this handoff (for documentation purposes).
   */
  description?: string;
}

/**
 * A handoff action that, when executed, returns a Command to transfer
 * control to the target agent in the parent swarm graph.
 *
 * The action:
 * 1. Returns a Command with `goto` set to the target agent name
 * 2. Sets `graph: Command.PARENT` so the command is applied in the parent graph
 * 3. Updates `activeAgent` to the target agent name
 *
 * @example
 * ```ts
 * const transferToReviewer = createHandoffAction({ agentName: "reviewer" });
 *
 * // Use as a node in an agent subgraph:
 * agentGraph.addNode("handoff_to_reviewer", transferToReviewer);
 * ```
 */
export function createHandoffAction({
  agentName,
  description: _description,
}: CreateHandoffParams): (state: Record<string, unknown>) => Command {
  const handoffName = `transfer_to_${normalizeAgentName(agentName)}`;

  const action = (state: Record<string, unknown>): Command => {
    // Pass through the current messages state and switch activeAgent
    return new Command({
      goto: agentName,
      graph: Command.PARENT,
      update: {
        ...(state.messages !== undefined ? { messages: state.messages } : {}),
        activeAgent: agentName,
      },
    });
  };

  // Attach metadata for introspection
  Object.defineProperty(action, "name", { value: handoffName });
  (action as unknown as Record<string, unknown>).__handoff_metadata = {
    [METADATA_KEY_HANDOFF_DESTINATION]: agentName,
  };

  return action;
}

/**
 * Get handoff destination names from an agent's metadata.
 *
 * This inspects the agent's compiled node metadata (set via addNode options)
 * to find any handoff destinations declared on the agent.
 *
 * @param agentMetadata - The metadata object from the agent node
 * @returns Array of destination agent names
 */
export function getHandoffDestinations(
  agentMetadata?: Record<string, unknown>
): string[] {
  if (!agentMetadata) return [];

  const destinations: string[] = [];

  // Check for handoff destinations in metadata
  const handoffDests = agentMetadata.__handoff_destinations;
  if (Array.isArray(handoffDests)) {
    destinations.push(...(handoffDests as string[]));
  }

  return destinations;
}
