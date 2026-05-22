export type FeatureStageResult<T> =
  | { cancelled: true }
  | { cancelled: false; value: T }

export interface FeatureWorkflowRunnerOptions<TEvent> {
  runId: string
  signal?: AbortSignal
  stepStarted(stepId: string, label: string): TEvent
  stepCompleted(stepId: string, output: unknown): TEvent
  runCancelled(): TEvent
}

export interface FeatureWorkflowStep<TEvent, TValue> {
  stepId: string
  label: string
  completedOutput: (value: TValue) => unknown
  run: () => AsyncGenerator<TEvent, TValue, void>
}

export class FeatureWorkflowRunner<TEvent> {
  constructor(private readonly options: FeatureWorkflowRunnerOptions<TEvent>) {}

  async *runStep<TValue>(
    step: FeatureWorkflowStep<TEvent, TValue>,
  ): AsyncGenerator<TEvent, FeatureStageResult<TValue>, void> {
    yield this.options.stepStarted(step.stepId, step.label)
    if (await this.isCancelled()) {
      yield this.options.runCancelled()
      return { cancelled: true }
    }

    const value = yield* step.run()
    yield this.options.stepCompleted(step.stepId, step.completedOutput(value))
    return { cancelled: false, value }
  }

  private async isCancelled(): Promise<boolean> {
    if (this.options.signal?.aborted) return true
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 10)
    })
    return this.options.signal?.aborted ?? false
  }
}

export async function* immediateFeatureStage<TEvent, TValue>(
  value: TValue,
): AsyncGenerator<TEvent, TValue, void> {
  await Promise.resolve()
  const noEvents: TEvent[] = []
  for (const event of noEvents) {
    yield event
  }
  return value
}
