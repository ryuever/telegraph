import { describe, it, expect } from "vitest";
import { createSwarm, SwarmState } from "./swarm.js";
import { createHandoffAction, METADATA_KEY_HANDOFF_DESTINATION } from "./handoff.js";
import { Annotation } from "../state/annotation.js";
import { Command, END } from "../constants.js";
import type { SwarmAgent } from "./swarm.js";

// ═══════════════════════════════════════════════════════════════
//  Test 1: Basic swarm creation and validation
// ═══════════════════════════════════════════════════════════════

describe("createSwarm - Validation", () => {
  it("should throw when agent has no name", () => {
    expect(() => {
      createSwarm({
        agents: [{ name: "", action: async () => ({}) }],
        defaultActiveAgent: "",
      });
    }).toThrow(/must have a name/);
  });

  it("should throw when duplicate agent names", () => {
    expect(() => {
      createSwarm({
        agents: [
          { name: "agent1", action: async () => ({}) },
          { name: "agent1", action: async () => ({}) },
        ],
        defaultActiveAgent: "agent1",
      });
    }).toThrow(/already exists/);
  });

  it("should throw when default agent not in list", () => {
    expect(() => {
      createSwarm({
        agents: [{ name: "agent1", action: async () => ({}) }],
        defaultActiveAgent: "nonexistent",
      });
    }).toThrow(/not in the agents list/);
  });

  it("should throw when custom stateSchema missing activeAgent", () => {
    const BadState = Annotation.Root({
      messages: Annotation<string[]>({
        reducer: (a, b) => [...a, ...b],
        default: () => [],
      }),
    });

    expect(() => {
      createSwarm({
        agents: [{ name: "agent1", action: async () => ({}) }],
        defaultActiveAgent: "agent1",
        stateSchema: BadState,
      });
    }).toThrow(/activeAgent/);
  });
});

// ═══════════════════════════════════════════════════════════════
//  Test 2: Simple swarm with two agents (no handoff)
// ═══════════════════════════════════════════════════════════════

describe("createSwarm - Basic Execution", () => {
  it("should route to default agent when no activeAgent set", async () => {
    const agents: SwarmAgent[] = [
      {
        name: "greeter",
        action: async (state: Record<string, unknown>) => ({
          messages: ["Hello! I am the greeter."],
        }),
      },
      {
        name: "helper",
        action: async (state: Record<string, unknown>) => ({
          messages: ["I am the helper."],
        }),
      },
    ];

    const swarm = createSwarm({
      agents,
      defaultActiveAgent: "greeter",
    });

    const graph = swarm
      .addEdge("greeter" as any, END)
      .addEdge("helper" as any, END)
      .compile();

    const result = await graph.invoke({
      messages: ["User: Hi"],
    });

    expect(result.messages).toContain("Hello! I am the greeter.");
    expect(result.activeAgent).toBeUndefined();
  });

  it("should route to specified activeAgent", async () => {
    const agents: SwarmAgent[] = [
      {
        name: "greeter",
        action: async () => ({
          messages: ["Hello from greeter!"],
        }),
      },
      {
        name: "helper",
        action: async () => ({
          messages: ["Hello from helper!"],
        }),
      },
    ];

    const swarm = createSwarm({
      agents,
      defaultActiveAgent: "greeter",
    });

    const graph = swarm
      .addEdge("greeter" as any, END)
      .addEdge("helper" as any, END)
      .compile();

    const result = await graph.invoke({
      messages: ["User: Hi"],
      activeAgent: "helper",
    });

    expect(result.messages).toContain("Hello from helper!");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Test 3: Swarm with Command-based handoff
// ═══════════════════════════════════════════════════════════════

describe("createSwarm - Command Handoff", () => {
  it("should hand off control from one agent to another via Command", async () => {
    const agents: SwarmAgent[] = [
      {
        name: "triage",
        handoffTo: ["billing", "technical"],
        action: async (state: Record<string, unknown>) => {
          const msgs = state.messages as string[];
          const lastMsg = msgs[msgs.length - 1] || "";
          if (lastMsg.includes("bill")) {
            return new Command({
              goto: "billing",
              update: {
                activeAgent: "billing",
                messages: ["Transferring to billing department..."],
              },
            });
          }
          return new Command({
            goto: "technical",
            update: {
              activeAgent: "technical",
              messages: ["Transferring to technical support..."],
            },
          });
        },
      },
      {
        name: "billing",
        action: async () => ({
          messages: ["Billing: I can help with your invoice."],
        }),
      },
      {
        name: "technical",
        action: async () => ({
          messages: ["Tech: Let me check the system."],
        }),
      },
    ];

    const swarm = createSwarm({
      agents,
      defaultActiveAgent: "triage",
    });

    const graph = swarm
      .addEdge("billing" as any, END)
      .addEdge("technical" as any, END)
      .compile();

    // Test routing to billing
    const result1 = await graph.invoke({
      messages: ["I have a bill question"],
    });
    // Command update writes messages via reducer; the triage handoff message
    // and billing agent response should both appear in the final state
    expect(result1.messages).toContain("Transferring to billing department...");
    expect(result1.messages).toContain("Billing: I can help with your invoice.");
    expect(result1.activeAgent).toBe("billing");

    // Test routing to technical
    const result2 = await graph.invoke({
      messages: ["My app is crashing"],
    });
    expect(result2.messages).toContain("Transferring to technical support...");
    expect(result2.messages).toContain("Tech: Let me check the system.");
    expect(result2.activeAgent).toBe("technical");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Test 4: createHandoffAction
// ═══════════════════════════════════════════════════════════════

describe("createHandoffAction", () => {
  it("should create an action that returns a Command to the target agent", () => {
    const handoff = createHandoffAction({ agentName: "reviewer" });
    const result = handoff({ messages: ["please review"] });

    expect(result).toBeInstanceOf(Command);
    expect(result.goto).toBe("reviewer");
    expect(result.graph).toBe(Command.PARENT);
    expect((result.update as Record<string, unknown>).activeAgent).toBe("reviewer");
  });

  it("should set the function name based on agent name", () => {
    const handoff = createHandoffAction({ agentName: "My Agent" });
    expect(handoff.name).toBe("transfer_to_my_agent");
  });

  it("should attach handoff metadata", () => {
    const handoff = createHandoffAction({ agentName: "billing" });
    const meta = (handoff as Record<string, unknown>).__handoff_metadata as Record<string, unknown>;
    expect(meta[METADATA_KEY_HANDOFF_DESTINATION]).toBe("billing");
  });
});

// ═══════════════════════════════════════════════════════════════
//  Test 5: Custom state schema
// ═══════════════════════════════════════════════════════════════

describe("createSwarm - Custom State Schema", () => {
  it("should work with custom state schema that includes activeAgent", async () => {
    const CustomState = Annotation.Root({
      messages: Annotation<string[]>({
        reducer: (a, b) => [...a, ...b],
        default: () => [],
      }),
      activeAgent: Annotation<string>(),
      priority: Annotation<string>(),
    });

    const agents: SwarmAgent[] = [
      {
        name: "dispatcher",
        action: async () => ({
          messages: ["Dispatching..."],
          priority: "high",
        }),
      },
    ];

    const swarm = createSwarm({
      agents,
      defaultActiveAgent: "dispatcher",
      stateSchema: CustomState,
    });

    const graph = swarm
      .addEdge("dispatcher" as any, END)
      .compile();

    const result = await graph.invoke({
      messages: ["incoming request"],
    });

    expect(result.messages).toContain("Dispatching...");
    expect(result.priority).toBe("high");
  });
});
