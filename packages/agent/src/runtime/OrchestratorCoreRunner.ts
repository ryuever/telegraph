import type { RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import {
  TelegraphOrchestratorRuntime,
  type TelegraphOrchestratorRunner,
  type TelegraphOrchestratorSignal,
} from './TelegraphOrchestratorRuntime'
import {
  readOrchestratorCheckpointMetadata,
  type OrchestratorCheckpointControl,
  type OrchestratorCheckpointController,
} from './OrchestratorCheckpointController'
import {
  Annotation,
  type Command,
  Command as GraphCommand,
  type CompiledStateGraph,
  END,
  interrupt,
  isGraphInterrupt,
  START,
  StateGraph,
} from '@/packages/orchestrator-core'
import type {
  CompiledNode,
  InvokeOptions,
  NodeAction,
} from '@/packages/orchestrator-core'

export interface OrchestratorCoreRunnerOptions<S = Record<string, unknown>, U = Partial<S>> {
  graph: CompiledStateGraph<S, U> | (() => CompiledStateGraph<S, U>)
  input?: (input: RuntimeInput) => Partial<S> | Command
  invokeOptions?: (input: RuntimeInput) => InvokeOptions | undefined
  checkpointController?: OrchestratorCheckpointController
  now?: () => number
}

export class OrchestratorCoreRunner<S = Record<string, unknown>, U = Partial<S>>
implements TelegraphOrchestratorRunner {
  private readonly graph: CompiledStateGraph<S, U> | (() => CompiledStateGraph<S, U>)
  private readonly inputMapper?: (input: RuntimeInput) => Partial<S> | Command
  private readonly optionsMapper?: (input: RuntimeInput) => InvokeOptions | undefined
  private readonly checkpointController?: OrchestratorCheckpointController
  private readonly now: () => number

  constructor(options: OrchestratorCoreRunnerOptions<S, U>) {
    this.graph = options.graph
    this.inputMapper = options.input
    this.optionsMapper = options.invokeOptions
    this.checkpointController = options.checkpointController
    this.now = options.now ?? Date.now
  }

  async *run(input: RuntimeInput): AsyncIterable<TelegraphOrchestratorSignal> {
    const graph = typeof this.graph === 'function' ? this.graph() : this.graph
    const queue = new SignalQueue()
    const checkpoint = this.checkpointControl(input)
    const restore = instrumentGraph(graph, queue, this.now, input, this.checkpointController)
    const invokeOptions = mergeInvokeOptions(this.optionsMapper?.(input), checkpoint, input.signal)
    const graphInput = checkpoint?.resume
      ? new GraphCommand({ resume: checkpoint.resume.value })
      : (this.inputMapper?.(input) ?? defaultGraphInput(input)) as Partial<S> | Command

    void (async () => {
      try {
        const output = await graph.invoke(
          graphInput,
          invokeOptions,
        )
        await emitLatestCheckpoint(graph, invokeOptions, queue, this.now)
        queue.push({ type: 'completed', output, ts: this.now() })
      } catch (error: unknown) {
        if (isGraphInterrupt(error)) {
          for (const interrupt of error.interrupts) {
            queue.push({
              type: 'interrupt',
              interruptId: interrupt.id,
              nodeId: interrupt.nodeId,
              reason: interruptReason(interrupt.value),
              resumable: interrupt.resumable,
              raw: interrupt,
              ts: this.now(),
            })
          }
          queue.push({
            type: 'completed',
            output: { interrupted: true },
            raw: { interrupts: error.interrupts },
            ts: this.now(),
          })
          return
        }
        queue.push({ type: 'failed', error: normalizeError(error), ts: this.now() })
      } finally {
        restore()
        queue.close()
      }
    })()

    yield* queue
  }

  private checkpointControl(input: RuntimeInput): OrchestratorCheckpointControl | undefined {
    return this.checkpointController?.checkpoint(input) ?? readOrchestratorCheckpointMetadata(input.metadata)
  }
}

function mergeInvokeOptions(
  base: InvokeOptions | undefined,
  checkpoint: OrchestratorCheckpointControl | undefined,
  signal: AbortSignal | undefined,
): InvokeOptions {
  return {
    ...base,
    signal,
    configurable: {
      ...base?.configurable,
      ...(checkpoint?.threadId ? { thread_id: checkpoint.threadId } : {}),
      ...(checkpoint?.checkpointNamespace ? { checkpoint_ns: checkpoint.checkpointNamespace } : {}),
      ...(checkpoint?.checkpointId ? { checkpoint_id: checkpoint.checkpointId } : {}),
    },
  }
}

async function emitLatestCheckpoint<S, U>(
  graph: CompiledStateGraph<S, U>,
  options: InvokeOptions,
  queue: SignalQueue,
  now: () => number,
): Promise<void> {
  const threadId = options.configurable?.thread_id
  if (!graph.checkpointer || !threadId) return

  for await (const item of graph.getStateHistory({
    thread_id: threadId,
    checkpoint_ns: options.configurable?.checkpoint_ns,
    limit: 1,
  })) {
    queue.push({
      type: 'checkpoint',
      checkpointId: item.config.configurable?.checkpoint_id ?? 'unknown',
      state: item.state,
      raw: {
        config: item.config,
        metadata: item.metadata,
        parentConfig: item.parentConfig,
      },
      ts: now(),
    })
    return
  }
}

export function createDemoOrchestratorRuntime(): TelegraphOrchestratorRuntime {
  const DemoState = Annotation.Root({
    message: Annotation<string>(),
    reply: Annotation<string>(),
  })

  const createGraph = () => new StateGraph(DemoState)
    .addNode('plan', async (state) => ({
      reply: `orchestrator-core received: ${state.message}`,
    }), { metadata: { label: 'Plan' } })
    .addEdge(START, 'plan')
    .addEdge('plan', END)
    .compile()

  return new TelegraphOrchestratorRuntime({
    runner: new OrchestratorCoreRunner({
      graph: createGraph,
      input: input => ({ message: input.message }),
    }),
  })
}

function defaultGraphInput(input: RuntimeInput): Record<string, unknown> {
  return {
    message: input.message,
    runId: input.runId,
    sessionId: input.sessionId,
  }
}

function instrumentGraph<S, U>(
  graph: CompiledStateGraph<S, U>,
  queue: SignalQueue,
  now: () => number,
  input: RuntimeInput,
  checkpointController: OrchestratorCheckpointController | undefined,
): () => void {
  const originals: Array<[string, NodeAction<S, U> | undefined]> = []

  for (const [nodeId, node] of Object.entries(graph.nodes)) {
    const original = node.action
    originals.push([nodeId, original])
    if (!original) continue

    node.action = (async (state: S, config) => {
      queue.push({
        type: 'node_started',
        nodeId,
        label: nodeLabel(nodeId, node),
        kind: 'worker',
        raw: { taskId: config?.taskId, triggers: node.triggers },
        ts: now(),
      })

      const pause = checkpointController?.consumePause?.(input, nodeId)
      if (pause) {
        interrupt(pause)
      }

      const output = await original(state, config)
      const targets = inferTargets(nodeId, node, output, graph.nodes)

      queue.push({
        type: 'node_completed',
        nodeId,
        label: nodeLabel(nodeId, node),
        kind: 'worker',
        output,
        raw: { taskId: config?.taskId },
        ts: now(),
      })

      for (const target of targets) {
        queue.push({
          type: 'edge_taken',
          from: nodeId,
          to: target,
          condition: 'inferred',
          raw: { taskId: config?.taskId },
          ts: now(),
        })
      }

      return output
    }) as NodeAction<S, U>
  }

  return () => {
    for (const [nodeId, original] of originals) {
      graph.nodes[nodeId].action = original
    }
  }
}

function inferTargets<S, U>(
  nodeId: string,
  node: CompiledNode<S, U>,
  output: U,
  nodes: Record<string, CompiledNode<S, U>>,
): string[] {
  const targets = new Set<string>()
  const branchTargets = output && typeof output === 'object'
    ? (output as Record<string, unknown>).__branch_targets__
    : undefined

  if (Array.isArray(branchTargets)) {
    for (const target of branchTargets) {
      if (typeof target === 'string' && target in nodes) {
        targets.add(target)
      }
    }
  }

  for (const writer of node.writers) {
    const explicit = branchTarget(writer.channel)
    if (explicit && explicit in nodes) {
      targets.add(explicit)
      continue
    }
    if (writer.channel.startsWith('join:')) {
      for (const [target, candidate] of Object.entries(nodes)) {
        if (target !== nodeId && candidate.triggers.includes(writer.channel)) {
          targets.add(target)
        }
      }
    }
  }

  return [...targets]
}

function branchTarget(channel: string): string | undefined {
  const prefix = 'branch:to:'
  return channel.startsWith(prefix) ? channel.slice(prefix.length) : undefined
}

function nodeLabel<S, U>(nodeId: string, node: CompiledNode<S, U>): string {
  return typeof node.metadata?.label === 'string' ? node.metadata.label : nodeId
}

function interruptReason(value: unknown): string {
  if (value && typeof value === 'object' && 'type' in value) {
    return String((value as { type: unknown }).type)
  }
  return 'interrupt'
}

function normalizeError(error: unknown): Error | string {
  return error instanceof Error ? error : String(error)
}

class SignalQueue implements AsyncIterable<TelegraphOrchestratorSignal> {
  private readonly items: TelegraphOrchestratorSignal[] = []
  private waiters: Array<() => void> = []
  private closed = false

  push(signal: TelegraphOrchestratorSignal): void {
    if (this.closed) return
    this.items.push(signal)
    this.flush()
  }

  close(): void {
    this.closed = true
    this.flush()
  }

  async *[Symbol.asyncIterator](): AsyncIterator<TelegraphOrchestratorSignal> {
    while (!this.closed || this.items.length > 0) {
      const item = this.items.shift()
      if (item) {
        yield item
        continue
      }
      await new Promise<void>(resolve => {
        this.waiters.push(resolve)
      })
    }
  }

  private flush(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const resolve of waiters) {
      resolve()
    }
  }
}
