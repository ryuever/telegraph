import type { RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import {
  TelegraphOrchestratorRuntime,
  type TelegraphOrchestratorRunner,
  type TelegraphOrchestratorSignal,
} from './TelegraphOrchestratorRuntime'
import {
  Annotation,
  type Command,
  type CompiledStateGraph,
  END,
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
  now?: () => number
}

export class OrchestratorCoreRunner<S = Record<string, unknown>, U = Partial<S>>
implements TelegraphOrchestratorRunner {
  private readonly graph: CompiledStateGraph<S, U> | (() => CompiledStateGraph<S, U>)
  private readonly inputMapper?: (input: RuntimeInput) => Partial<S> | Command
  private readonly optionsMapper?: (input: RuntimeInput) => InvokeOptions | undefined
  private readonly now: () => number

  constructor(options: OrchestratorCoreRunnerOptions<S, U>) {
    this.graph = options.graph
    this.inputMapper = options.input
    this.optionsMapper = options.invokeOptions
    this.now = options.now ?? Date.now
  }

  async *run(input: RuntimeInput): AsyncIterable<TelegraphOrchestratorSignal> {
    const graph = typeof this.graph === 'function' ? this.graph() : this.graph
    const queue = new SignalQueue()
    const restore = instrumentGraph(graph, queue, this.now)
    const invokeOptions = {
      ...this.optionsMapper?.(input),
      signal: input.signal,
    }

    void (async () => {
      try {
        const output = await graph.invoke(
          (this.inputMapper?.(input) ?? defaultGraphInput(input)) as Partial<S> | Command,
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
