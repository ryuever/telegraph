export interface DurableIdempotencyInput {
  runId: string
  stepId: string
  callId?: string
}

export function durableIdempotencyKey(input: DurableIdempotencyInput): string {
  return [
    'run',
    encodePart(input.runId),
    'step',
    encodePart(input.stepId),
    input.callId ? `call:${encodePart(input.callId)}` : undefined,
  ].filter(Boolean).join(':')
}

function encodePart(value: string): string {
  return encodeURIComponent(value)
}
