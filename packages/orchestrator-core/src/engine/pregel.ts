/**
 * Pregel execution engine — the core runtime that executes compiled graphs.
 *
 * Implements the superstep-based message passing model:
 * 1. Initialize channels from input (or restore from checkpoint)
 * 2. Find triggered nodes (via channel version comparison)
 * 3. Execute all triggered nodes in parallel
 * 4. Collect writes, batch-apply to channels
 * 5. Save checkpoint (if checkpointer provided)
 * 6. Repeat until no more nodes are triggered or recursion limit hit
 * 7. Read output channels
 *
 * ## Interrupt/Resume Support
 *
 * The engine supports pausing and resuming execution via the interrupt mechanism:
 *
 * - **interruptBefore**: Pause before executing specified nodes
 * - **interruptAfter**: Pause after executing specified nodes
 * - **interrupt()**: Nodes can call `interrupt(value)` to pause mid-execution
 * - **Command.resume**: Resume from an interrupt with provided data
 *
 * When an interrupt occurs:
 * 1. Current state is saved to checkpoint with interrupt metadata
 * 2. GraphInterrupt is thrown to the caller with interrupt info
 * 3. On resume (via Command.resume), state is restored from checkpoint
 * 4. The interrupted node is re-executed with resume values injected
 */

import { BaseChannel } from "../channels/base.js";
import {
  TASKS,
  PASSTHROUGH,
  SKIP_WRITE,
  isSend,
  Send,
  isCommand,
} from "../constants.js";
import {
  GraphRecursionError,
  InvalidUpdateError,
} from "../errors.js";
import {
  GraphInterrupt,
  isGraphInterrupt,
  interruptContextStorage,
} from "../interrupt.js";
import type { InterruptContext, InterruptInfo } from "../interrupt.js";
import type { CompiledNode } from "../graph/types.js";
import type {
  BaseCheckpointSaver,
  Checkpoint,
} from "../checkpoint/base.js";
import type { CheckpointConfig, CheckpointMetadata } from "../checkpoint/types.js";
import { INTERRUPT, RESUME } from "../checkpoint/serde/types.js";
import { uuid6 } from "../checkpoint/id.js";

/**
 * A null version sentinel for channel version comparisons.
 */
const NULL_VERSION = -1;

/**
 * A task prepared for execution in a superstep.
 */
interface PregelTask {
  /** Unique identifier for this task. */
  id: string;
  /** Node name. */
  name: string;
  /** Input data for the node function. */
  input: unknown;
  /** Writes collected during execution: [channelName, value][]. */
  writes: [string, unknown][];
  /** Which trigger channels caused this task. */
  triggers: string[];
}

/**
 * Options for Pregel graph execution.
 */
export interface PregelExecutionOptions<S, U> {
  nodes: Record<string, CompiledNode<S, U>>;
  channelSpecs: Record<string, BaseChannel>;
  inputChannels: string | string[];
  outputChannels: string | string[];
  input: unknown;
  recursionLimit?: number;
  signal?: AbortSignal;
  onStep?: (step: number, channels: Record<string, BaseChannel>) => void;
  /** Checkpoint saver for state persistence. */
  checkpointer?: BaseCheckpointSaver;
  /** Configuration for checkpoint operations (thread_id, etc.). */
  checkpointConfig?: CheckpointConfig;
  /** Nodes to interrupt before execution. */
  interruptBefore?: string[];
  /** Nodes to interrupt after execution. */
  interruptAfter?: string[];
  /** Resume values from Command({ resume: ... }). */
  resumeValues?: unknown[];
}

/**
 * Result of a Pregel graph execution.
 */
export interface PregelExecutionResult {
  /** Output state values. */
  output: Record<string, unknown>;
  /** Whether the graph was interrupted (not completed). */
  interrupted: boolean;
  /** Interrupt information if the graph was interrupted. */
  interrupts?: InterruptInfo[];
}

/**
 * Execute a compiled graph with the Pregel superstep model.
 *
 * @param options - Execution options including nodes, channels, and optional checkpointer
 * @returns The output state
 * @throws {GraphInterrupt} When execution is interrupted
 */
export async function executePregelGraph<S, U>(
  options: PregelExecutionOptions<S, U>
): Promise<Record<string, unknown>> {
  const {
    nodes,
    channelSpecs,
    inputChannels,
    outputChannels,
    input,
    recursionLimit = 25,
    signal,
    onStep,
    checkpointer,
    checkpointConfig,
    interruptBefore = [],
    interruptAfter = [],
    resumeValues = [],
  } = options;

  // ── 1. Initialize channels ──
  const channels: Record<string, BaseChannel> = {};
  const channelVersions: Record<string, number> = {};
  const versionsSeen: Record<string, Record<string, number>> = {};
  let maxVersion = 0;
  let currentStep = -1;
  let parentCheckpointId: string | undefined;

  // Track if we're resuming from a checkpoint (Command.resume flow)
  const isResuming = resumeValues.length > 0;
  let resumedFromInterrupt = false;
  let interruptedNodeName: string | undefined;

  // Try to restore from checkpoint if checkpointer is provided
  if (checkpointer && checkpointConfig?.configurable?.thread_id) {
    const savedTuple = await checkpointer.getTuple(checkpointConfig);

    if (savedTuple) {
      const savedCheckpoint = savedTuple.checkpoint;
      parentCheckpointId = savedCheckpoint.id;
      currentStep = savedTuple.metadata?.step ?? -1;

      // Restore channels from checkpoint
      for (const [name, spec] of Object.entries(channelSpecs)) {
        const savedValue = savedCheckpoint.channel_values[name];
        channels[name] = spec.fromCheckpoint(savedValue);
        channelVersions[name] =
          (savedCheckpoint.channel_versions[name] as number) ?? 0;
      }

      // Restore version tracking
      for (const [nodeName, seen] of Object.entries(
        savedCheckpoint.versions_seen
      )) {
        versionsSeen[nodeName] = { ...(seen as Record<string, number>) };
      }

      // Update maxVersion
      maxVersion = Math.max(
        0,
        ...Object.values(channelVersions)
      );

      // Check for interrupt metadata in pending writes
      if (isResuming && savedTuple.pendingWrites) {
        const interruptWrites = savedTuple.pendingWrites.filter(
          ([, channel]) => channel === INTERRUPT
        );
        if (interruptWrites.length > 0) {
          resumedFromInterrupt = true;
          // Extract the interrupted node name from the interrupt info
          const lastInterrupt = interruptWrites[interruptWrites.length - 1];
          const interruptData = lastInterrupt[2] as InterruptInfo | undefined;
          interruptedNodeName = interruptData?.nodeId;
        }
      }
    } else {
      // No saved checkpoint — initialize fresh
      _initChannelsFresh(channels, channelVersions, channelSpecs);
    }
  } else {
    // No checkpointer — initialize fresh
    _initChannelsFresh(channels, channelVersions, channelSpecs);
  }

  // Build trigger-to-nodes mapping for finish detection
  const triggerToNodes: Record<string, string[]> = {};
  for (const [name, node] of Object.entries(nodes)) {
    for (const trigger of node.triggers) {
      if (!triggerToNodes[trigger]) {
        triggerToNodes[trigger] = [];
      }
      triggerToNodes[trigger].push(name);
    }
  }

  // ── 2. Apply input to channels (skip if resuming from interrupt) ──
  if (!resumedFromInterrupt) {
    // For non-resume flows, apply input normally
    if (!isCommand(input)) {
      applyInput(channels, channelVersions, inputChannels, input, () => ++maxVersion);
    }

    // Save initial "input" checkpoint
    if (checkpointer && checkpointConfig?.configurable?.thread_id) {
      currentStep += 1;
      await _saveCheckpoint(
        checkpointer,
        checkpointConfig,
        channels,
        channelVersions,
        versionsSeen,
        currentStep - 1, // step -1 for input checkpoint
        "input",
        parentCheckpointId
      );
    }
  }

  // ── 3. Superstep loop ──
  for (let step = 0; step < recursionLimit; step++) {
    if (signal?.aborted) {
      throw new Error("Graph execution was aborted.");
    }

    // 3a. Prepare tasks: find triggered nodes
    let tasks: PregelTask[];

    if (resumedFromInterrupt && step === 0 && interruptedNodeName) {
      // On resume, re-execute the interrupted node
      const node = nodes[interruptedNodeName];
      if (node) {
        const nodeInput = buildNodeInput(node, channels);
        tasks = [{
          id: `resume:${step}:${interruptedNodeName}`,
          name: interruptedNodeName,
          input: nodeInput,
          writes: [],
          triggers: node.triggers,
        }];
      } else {
        tasks = prepareTasks(nodes, channels, channelVersions, versionsSeen, step);
      }
    } else {
      tasks = prepareTasks(nodes, channels, channelVersions, versionsSeen, step);
    }

    // 3b. No tasks → graph is done
    if (tasks.length === 0) {
      break;
    }

    // 3c. Check interruptBefore
    if (interruptBefore.length > 0 && !resumedFromInterrupt) {
      const shouldInterrupt = tasks.some((t) => interruptBefore.includes(t.name));
      if (shouldInterrupt) {
        const interruptedTasks = tasks.filter((t) => interruptBefore.includes(t.name));

        // Save checkpoint before interrupting
        if (checkpointer && checkpointConfig?.configurable?.thread_id) {
          currentStep += 1;
          const checkpointId = await _saveCheckpointReturnId(
            checkpointer,
            checkpointConfig,
            channels,
            channelVersions,
            versionsSeen,
            currentStep,
            "loop",
            parentCheckpointId
          );

          // Save interrupt info as pending writes
          const interrupts: InterruptInfo[] = interruptedTasks.map((t) => ({
            id: uuid6(0),
            value: { type: "interrupt_before", node: t.name },
            nodeId: t.name,
            resumable: true,
          }));

          await checkpointer.putWrites(
            {
              configurable: {
                ...checkpointConfig.configurable,
                checkpoint_id: checkpointId,
              },
            },
            interrupts.map((i) => [INTERRUPT, i]),
            interruptedTasks[0].id
          );

          throw new GraphInterrupt(interrupts);
        }

        // No checkpointer — still throw but can't resume
        const interrupts: InterruptInfo[] = interruptedTasks.map((t) => ({
          id: uuid6(0),
          value: { type: "interrupt_before", node: t.name },
          nodeId: t.name,
          resumable: false,
        }));
        throw new GraphInterrupt(interrupts);
      }
    }

    // Clear the resume flag after the first superstep
    if (resumedFromInterrupt && step === 0) {
      resumedFromInterrupt = false;
    }

    // 3d. Execute all tasks (in parallel), with interrupt context
    const collectedInterrupts: InterruptInfo[] = [];
    try {
      await executeTasksWithInterruptSupport(
        tasks,
        nodes,
        resumeValues,
        collectedInterrupts
      );
    } catch (error) {
      if (isGraphInterrupt(error)) {
        // Save checkpoint with interrupt info
        if (checkpointer && checkpointConfig?.configurable?.thread_id) {
          // First apply any writes that were collected before the interrupt
          applyWrites(
            channels,
            channelVersions,
            versionsSeen,
            tasks,
            triggerToNodes,
            () => ++maxVersion
          );

          currentStep += 1;
          const checkpointId = await _saveCheckpointReturnId(
            checkpointer,
            checkpointConfig,
            channels,
            channelVersions,
            versionsSeen,
            currentStep,
            "loop",
            parentCheckpointId
          );

          // Save interrupt info as pending writes
          await checkpointer.putWrites(
            {
              configurable: {
                ...checkpointConfig.configurable,
                checkpoint_id: checkpointId,
              },
            },
            error.interrupts.map((i) => [INTERRUPT, i]),
            tasks[0].id
          );
        }

        throw error;
      }
      throw error;
    }

    // 3e. Apply all writes
    applyWrites(
      channels,
      channelVersions,
      versionsSeen,
      tasks,
      triggerToNodes,
      () => ++maxVersion
    );

    // 3f. Call step callback
    onStep?.(step, channels);

    // 3g. Save "loop" checkpoint after each superstep
    if (checkpointer && checkpointConfig?.configurable?.thread_id) {
      currentStep += 1;
      parentCheckpointId = await _saveCheckpointReturnId(
        checkpointer,
        checkpointConfig,
        channels,
        channelVersions,
        versionsSeen,
        currentStep,
        "loop",
        parentCheckpointId
      );
    }

    // 3h. Check interruptAfter
    if (interruptAfter.length > 0) {
      const executedInterruptAfter = tasks.filter((t) =>
        interruptAfter.includes(t.name)
      );
      if (executedInterruptAfter.length > 0) {
        const interrupts: InterruptInfo[] = executedInterruptAfter.map((t) => ({
          id: uuid6(0),
          value: { type: "interrupt_after", node: t.name },
          nodeId: t.name,
          resumable: !!checkpointer,
        }));

        // Save interrupt info as pending writes
        if (checkpointer && checkpointConfig?.configurable?.thread_id && parentCheckpointId) {
          await checkpointer.putWrites(
            {
              configurable: {
                ...checkpointConfig.configurable,
                checkpoint_id: parentCheckpointId,
              },
            },
            interrupts.map((i) => [INTERRUPT, i]),
            executedInterruptAfter[0].id
          );
        }

        throw new GraphInterrupt(interrupts);
      }
    }

    // Check if we're at the limit
    if (step === recursionLimit - 1) {
      // Check if there would be more tasks
      const nextTasks = prepareTasks(nodes, channels, channelVersions, versionsSeen, step + 1);
      if (nextTasks.length > 0) {
        throw new GraphRecursionError(
          `Graph exceeded recursion limit of ${recursionLimit}. ` +
            "Increase the limit or restructure your graph."
        );
      }
    }
  }

  // ── 4. Read output ──
  return readChannels(channels, outputChannels);
}

// ═══════════════════════════════════════════════════════════════
//  Internal helpers
// ═══════════════════════════════════════════════════════════════

/**
 * Initialize channels from specs (fresh start, no checkpoint).
 */
function _initChannelsFresh(
  channels: Record<string, BaseChannel>,
  channelVersions: Record<string, number>,
  channelSpecs: Record<string, BaseChannel>
): void {
  for (const [name, spec] of Object.entries(channelSpecs)) {
    channels[name] = spec.fromCheckpoint();
    channelVersions[name] = 0;
  }
}

/**
 * Save a checkpoint and return the new config.
 */
async function _saveCheckpoint(
  checkpointer: BaseCheckpointSaver,
  config: CheckpointConfig,
  channels: Record<string, BaseChannel>,
  channelVersions: Record<string, number>,
  versionsSeen: Record<string, Record<string, number>>,
  step: number,
  source: "input" | "loop",
  parentCheckpointId?: string
): Promise<void> {
  const checkpoint = _buildCheckpoint(
    channels,
    channelVersions,
    versionsSeen
  );

  const metadata: CheckpointMetadata = {
    source,
    step,
    parents: parentCheckpointId
      ? { "": parentCheckpointId }
      : {},
  };

  const putConfig: CheckpointConfig = {
    configurable: {
      ...config.configurable,
      checkpoint_id: parentCheckpointId,
    },
  };

  await checkpointer.put(putConfig, checkpoint, metadata, channelVersions);
}

/**
 * Save a checkpoint and return the new checkpoint ID.
 */
async function _saveCheckpointReturnId(
  checkpointer: BaseCheckpointSaver,
  config: CheckpointConfig,
  channels: Record<string, BaseChannel>,
  channelVersions: Record<string, number>,
  versionsSeen: Record<string, Record<string, number>>,
  step: number,
  source: "input" | "loop",
  parentCheckpointId?: string
): Promise<string> {
  const checkpoint = _buildCheckpoint(
    channels,
    channelVersions,
    versionsSeen
  );

  const metadata: CheckpointMetadata = {
    source,
    step,
    parents: parentCheckpointId
      ? { "": parentCheckpointId }
      : {},
  };

  const putConfig: CheckpointConfig = {
    configurable: {
      ...config.configurable,
      checkpoint_id: parentCheckpointId,
    },
  };

  await checkpointer.put(putConfig, checkpoint, metadata, channelVersions);
  return checkpoint.id;
}

/**
 * Build a Checkpoint from current channel state.
 */
function _buildCheckpoint(
  channels: Record<string, BaseChannel>,
  channelVersions: Record<string, number>,
  versionsSeen: Record<string, Record<string, number>>
): Checkpoint {
  const channelValues: Record<string, unknown> = {};
  for (const [name, channel] of Object.entries(channels)) {
    try {
      channelValues[name] = channel.checkpoint();
    } catch {
      // Channel empty or doesn't support checkpointing
    }
  }

  return {
    v: 1,
    id: uuid6(0),
    ts: new Date().toISOString(),
    channel_values: channelValues,
    channel_versions: { ...channelVersions },
    versions_seen: JSON.parse(JSON.stringify(versionsSeen)),
  };
}

/**
 * Apply input data to the input channels.
 */
function applyInput(
  channels: Record<string, BaseChannel>,
  channelVersions: Record<string, number>,
  inputChannels: string | string[],
  input: unknown,
  getNextVersion: () => number
): void {
  if (typeof inputChannels === "string") {
    // Single input channel (e.g., START)
    const chan = inputChannels;
    if (channels[chan]) {
      if (channels[chan].update([input])) {
        channelVersions[chan] = getNextVersion();
      }
    }
  } else {
    // Multiple input channels (state keys)
    const inputObj = input as Record<string, unknown>;
    for (const key of inputChannels) {
      if (key in inputObj && channels[key]) {
        if (channels[key].update([inputObj[key]])) {
          channelVersions[key] = getNextVersion();
        }
      }
    }
  }
}

/**
 * Find all nodes that should be triggered based on channel version changes.
 */
function prepareTasks<S, U>(
  nodes: Record<string, CompiledNode<S, U>>,
  channels: Record<string, BaseChannel>,
  channelVersions: Record<string, number>,
  versionsSeen: Record<string, Record<string, number>>,
  step: number
): PregelTask[] {
  const tasks: PregelTask[] = [];

  // Handle PUSH tasks (from Send() in TASKS channel)
  if (channels[TASKS] && channels[TASKS].isAvailable()) {
    try {
      const sends = channels[TASKS].get() as Send[];
      for (let i = 0; i < sends.length; i++) {
        const send = sends[i];
        if (isSend(send) && send.node in nodes) {
          tasks.push({
            id: `push:${step}:${i}:${send.node}`,
            name: send.node,
            input: send.args,
            writes: [],
            triggers: [TASKS],
          });
        }
      }
    } catch {
      // TASKS channel empty, skip
    }
  }

  // Handle PULL tasks (based on channel versions)
  for (const [name, node] of Object.entries(nodes)) {
    const seen = versionsSeen[name] ?? {};

    // Check if any trigger channel has been updated since this node last saw it
    const triggeredChannels = node.triggers.filter((chan) => {
      if (!channels[chan]) return false;
      if (!channels[chan].isAvailable()) return false;
      return (channelVersions[chan] ?? NULL_VERSION) > (seen[chan] ?? NULL_VERSION);
    });

    if (triggeredChannels.length === 0) continue;

    // Build input from channels
    const input = buildNodeInput(node, channels);

    tasks.push({
      id: `pull:${step}:${name}`,
      name,
      input,
      writes: [],
      triggers: triggeredChannels,
    });
  }

  return tasks;
}

/**
 * Build the input object for a node by reading its input channels.
 */
function buildNodeInput<S, U>(
  node: CompiledNode<S, U>,
  channels: Record<string, BaseChannel>
): unknown {
  if (Array.isArray(node.channels)) {
    // Single channel input (e.g., ["__root__"])
    if (node.channels.length === 1) {
      const chan = node.channels[0];
      try {
        return channels[chan]?.get();
      } catch {
        return undefined;
      }
    }
    // Multiple channels as array (shouldn't happen in normal flow)
    const result: Record<string, unknown> = {};
    for (const chan of node.channels) {
      try {
        result[chan] = channels[chan]?.get();
      } catch {
        // Channel empty, skip
      }
    }
    return result;
  }

  // Object mapping: { inputKey: channelName }
  const result: Record<string, unknown> = {};
  for (const [key, chan] of Object.entries(node.channels)) {
    try {
      if (channels[chan]) {
        result[key] = channels[chan].get();
      }
    } catch {
      // Channel empty, skip
    }
  }

  return node.mapper ? node.mapper(result) : result;
}

/**
 * Execute all tasks in parallel with interrupt support.
 *
 * Each task runs within an AsyncLocalStorage context that provides
 * the interrupt mechanism. If a node calls `interrupt()`, the context
 * tracks the interrupt counter and provides resume values when available.
 */
async function executeTasksWithInterruptSupport<S, U>(
  tasks: PregelTask[],
  nodes: Record<string, CompiledNode<S, U>>,
  resumeValues: unknown[],
  collectedInterrupts: InterruptInfo[]
): Promise<void> {
  await Promise.all(
    tasks.map(async (task) => {
      const node = nodes[task.name];
      if (!node) return;

      // Create interrupt context for this task
      const interruptCtx: InterruptContext = {
        resumeValues: resumeValues,
        interruptCounter: 0,
        nodeId: task.name,
        collectedInterrupts: [],
      };

      try {
        let result: unknown;

        // Run within AsyncLocalStorage context
        result = await interruptContextStorage.run(interruptCtx, async () => {
          if (node.action) {
            return await node.action(task.input as S, {
              taskId: task.id,
            });
          } else {
            return task.input;
          }
        });

        // Process writes from result
        collectWrites(task, node, result);
      } catch (error) {
        if (isGraphInterrupt(error)) {
          // Propagate interrupt with collected info
          collectedInterrupts.push(...error.interrupts);
          throw error;
        }
        // Store error as a write for error handling
        task.writes.push(["__error__", error]);
        throw error;
      }
    })
  );
}

/**
 * Collect channel writes from a node's execution result.
 */
function collectWrites<S, U>(
  task: PregelTask,
  node: CompiledNode<S, U>,
  result: unknown
): void {
  for (const writer of node.writers) {
    let value: unknown;

    if (writer.value === PASSTHROUGH) {
      value = result;
    } else {
      value = writer.value;
    }

    if (value === SKIP_WRITE) continue;

    if (writer.mapper) {
      // Mapper transforms the value into [channel, value][] tuples
      const tuples = writer.mapper(value);
      if (tuples) {
        for (const [chan, val] of tuples) {
          task.writes.push([chan, val]);
        }
      }
    } else {
      if (value !== undefined) {
        task.writes.push([writer.channel, value]);
      }
    }
  }
}

/**
 * Batch-apply all task writes to channels.
 * This is the core of the superstep completion logic.
 */
function applyWrites(
  channels: Record<string, BaseChannel>,
  channelVersions: Record<string, number>,
  versionsSeen: Record<string, Record<string, number>>,
  tasks: PregelTask[],
  triggerToNodes: Record<string, string[]>,
  getNextVersion: () => number
): void {
  // 1. Update versions_seen for each task
  for (const task of tasks) {
    versionsSeen[task.name] ??= {};
    for (const chan of task.triggers) {
      versionsSeen[task.name][chan] = channelVersions[chan] ?? 0;
    }
  }

  // 2. Consume trigger channels (barrier resets, etc.)
  const allTriggers = new Set(tasks.flatMap((t) => t.triggers));
  for (const chan of allTriggers) {
    if (channels[chan] && channels[chan].consume()) {
      channelVersions[chan] = getNextVersion();
    }
  }

  // 3. Group writes by channel
  const writesByChannel: Record<string, unknown[]> = {};
  for (const task of tasks) {
    for (const [chan, val] of task.writes) {
      if (chan === "__error__") continue; // Skip error markers
      if (chan === TASKS) {
        // Send() objects go to TASKS channel
        writesByChannel[TASKS] ??= [];
        writesByChannel[TASKS].push(val);
        continue;
      }
      writesByChannel[chan] ??= [];
      writesByChannel[chan].push(val);
    }
  }

  // 4. Apply writes to channels
  const updatedChannels = new Set<string>();
  for (const [chan, vals] of Object.entries(writesByChannel)) {
    if (!channels[chan]) continue;
    try {
      if (channels[chan].update(vals)) {
        channelVersions[chan] = getNextVersion();
        updatedChannels.add(chan);
      }
    } catch (e) {
      throw new InvalidUpdateError(
        `Error updating channel "${chan}": ${(e as Error).message}`
      );
    }
  }

  // 5. Clear ephemeral channels that received no writes
  for (const chan of Object.keys(channels)) {
    if (!updatedChannels.has(chan) && channels[chan].isAvailable()) {
      const changed = channels[chan].update([]);
      if (changed) {
        // Don't bump version for empty updates, just clear
      }
    }
  }

  // 6. If no more nodes would be triggered, call finish() on all channels
  const wouldTrigger = Array.from(updatedChannels).some(
    (chan) => triggerToNodes[chan]?.length > 0
  );
  if (!wouldTrigger) {
    for (const chan of Object.keys(channels)) {
      channels[chan].finish();
    }
  }
}

/**
 * Read values from output channels.
 */
function readChannels(
  channels: Record<string, BaseChannel>,
  outputChannels: string | string[]
): Record<string, unknown> {
  if (typeof outputChannels === "string") {
    try {
      return channels[outputChannels]?.get() as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  const result: Record<string, unknown> = {};
  for (const chan of outputChannels) {
    try {
      if (channels[chan]?.isAvailable()) {
        result[chan] = channels[chan].get();
      }
    } catch {
      // Channel empty, skip
    }
  }
  return result;
}
