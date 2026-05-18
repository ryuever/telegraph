/**
 * Multi-agent Swarm for the orchestrator engine.
 *
 * A "swarm" is a group of agents (each a simple node action) wired together
 * so that any agent can hand off control to any other agent at runtime.
 *
 * The swarm works by:
 * 1. Maintaining a shared `activeAgent` state key that tracks which agent
 *    is currently in control.
 * 2. Using a lightweight `__router__` node (after START) that reads the
 *    current state and conditionally routes to the active agent.
 * 3. Each agent is added as a node. When an agent wants to transfer
 *    control, it returns a Command({ goto: targetAgent, update: { activeAgent } }).
 *
 * This is a standalone implementation that does NOT depend on @langchain/langgraph.
 * It uses only @orchestrator/core primitives.
 */

import { START, END } from "../constants.js";
import { Annotation, AnnotationRoot } from "../state/annotation.js";
import type { StateDefinition, StateType, UpdateType } from "../state/annotation.js";
import { StateGraph } from "../graph/state.js";
import type { NodeAction } from "../graph/types.js";

/** Internal name for the swarm router node. */
const ROUTER_NODE = "__swarm_router__";

/**
 * Default state schema for the swarm.
 * Includes a messages array (with append reducer) and an activeAgent tracker.
 */
export const SwarmState = Annotation.Root({
  messages: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
  activeAgent: Annotation<string>(),
});

/**
 * An agent definition for the swarm.
 */
export interface SwarmAgent<S = unknown, U = unknown> {
  /** Unique name for this agent. */
  name: string;

  /** The agent's action function. Receives state, returns partial update or Command. */
  action: NodeAction<S, U>;

  /**
   * List of agent names this agent can hand off to.
   * Used for building the graph topology (declaring valid destinations).
   */
  handoffTo?: string[];

  /** Optional description of this agent. */
  description?: string;
}

/**
 * Parameters for creating a swarm.
 */
export interface CreateSwarmParams<
  SD extends StateDefinition = StateDefinition,
> {
  /** List of agents to include in the swarm. */
  agents: SwarmAgent[];

  /**
   * Name of the default active agent.
   * This agent receives control when no activeAgent is set.
   */
  defaultActiveAgent: string;

  /**
   * Optional custom state schema.
   * Must include an `activeAgent` key.
   * Defaults to SwarmState.
   */
  stateSchema?: AnnotationRoot<SD>;
}

/**
 * Create a multi-agent swarm graph.
 *
 * The returned StateGraph can be compiled and invoked like any other graph.
 * Agents can transfer control to each other by returning a Command with
 * `goto` set to the target agent name.
 *
 * @example
 * ```ts
 * import { createSwarm, Command, END } from "@orchestrator/core";
 * import type { SwarmAgent } from "@orchestrator/core";
 *
 * const triage: SwarmAgent = {
 *   name: "triage",
 *   handoffTo: ["billing", "technical"],
 *   action: async (state) => {
 *     const msgs = state.messages;
 *     const lastMsg = msgs[msgs.length - 1] || "";
 *     if (lastMsg.includes("bill")) {
 *       return new Command({
 *         goto: "billing",
 *         update: { activeAgent: "billing", messages: ["Transferring to billing..."] },
 *       });
 *     }
 *     return new Command({
 *       goto: "technical",
 *       update: { activeAgent: "technical", messages: ["Transferring to tech support..."] },
 *     });
 *   },
 * };
 *
 * const billing: SwarmAgent = {
 *   name: "billing",
 *   action: async (state) => ({
 *     messages: ["Billing agent: I'll help with your bill."],
 *   }),
 * };
 *
 * const technical: SwarmAgent = {
 *   name: "technical",
 *   action: async (state) => ({
 *     messages: ["Tech support: Let me look into this."],
 *   }),
 * };
 *
 * const swarm = createSwarm({
 *   agents: [triage, billing, technical],
 *   defaultActiveAgent: "triage",
 * });
 *
 * const graph = swarm
 *   .addEdge("billing", END)
 *   .addEdge("technical", END)
 *   .compile();
 *
 * const result = await graph.invoke({
 *   messages: ["I have a billing question"],
 * });
 * ```
 *
 * @param params - Swarm configuration
 * @returns A StateGraph that can be compiled (add END edges before compiling)
 */
export function createSwarm<SD extends StateDefinition = StateDefinition>({
  agents,
  defaultActiveAgent,
  stateSchema,
}: CreateSwarmParams<SD>): StateGraph<
  AnnotationRoot<SD>,
  StateType<SD>,
  UpdateType<SD>,
  string
> {
  // Validate stateSchema has activeAgent
  if (stateSchema && !("activeAgent" in stateSchema.spec)) {
    throw new Error("Missing required key 'activeAgent' in stateSchema");
  }

  // Validate agents
  const agentNames = new Set<string>();
  for (const agent of agents) {
    if (!agent.name) {
      throw new Error(
        "Every agent must have a name. Got an agent without a name."
      );
    }
    if (agentNames.has(agent.name)) {
      throw new Error(
        `Agent with name '${agent.name}' already exists. Agent names must be unique.`
      );
    }
    agentNames.add(agent.name);
  }

  // Validate default agent exists
  if (!agentNames.has(defaultActiveAgent)) {
    throw new Error(
      `Default active agent '${defaultActiveAgent}' is not in the agents list: [${[...agentNames].join(", ")}]`
    );
  }

  // Build the graph
  const schema = stateSchema ?? SwarmState;
  const builder = new StateGraph(schema as AnnotationRoot<SD>) as unknown as StateGraph<
    SD,
    StateType<SD>,
    UpdateType<SD>,
    string
  >;

  // Add a lightweight router node that reads activeAgent and passes through.
  // This is needed because START → conditional edges execute the routing
  // function BEFORE input is written to state channels. By using an
  // intermediate router node, the input is already in state when routing.
  builder.addNode(
    ROUTER_NODE,
    (async (_state: StateType<SD>) => {
      // No-op: the router doesn't modify state.
      // Routing is handled by the conditional edge on this node.
      return {} as UpdateType<SD>;
    }) as NodeAction<StateType<SD>, UpdateType<SD>>
  );

  // START → router (static edge, so input gets written to state first)
  builder.addEdge(START as unknown as string, ROUTER_NODE);

  // Router → conditional edge → agents
  const agentList = [...agentNames];
  builder.addConditionalEdges(
    ROUTER_NODE as unknown as string,
    (state: StateType<SD>) => {
      const activeAgent = (state as Record<string, unknown>).activeAgent as
        | string
        | undefined;
      return activeAgent || defaultActiveAgent;
    },
    agentList
  );

  // Add all agent nodes
  for (const agent of agents) {
    const metadata: Record<string, unknown> = {};
    if (agent.handoffTo && agent.handoffTo.length > 0) {
      metadata.__handoff_destinations = agent.handoffTo;
    }
    if (agent.description) {
      metadata.description = agent.description;
    }

    builder.addNode(
      agent.name,
      agent.action as NodeAction<StateType<SD>, UpdateType<SD>>,
      { metadata }
    );
  }

  return builder as unknown as StateGraph<
    AnnotationRoot<SD>,
    StateType<SD>,
    UpdateType<SD>,
    string
  >;
}
