# Telegraph AI Elements

Telegraph AI elements describe agent activity as a compact timeline rather than as raw runtime events.
The visual grammar is:

- `reasoning`: safe reasoning summaries and progress, never private chain-of-thought deltas.
- `tool`: tool invocation, input, output, error, and call metadata.
- `workflow`: plans, steps, child runs, and queued work.
- `human`: approval, confirmation, or clarification requests.
- `result`: final output, artifacts, diffs, and completion state.
- `model`: model-level requests or streamed model activity when a diagnostic view needs it.

Use `AgentActivity` as the outer list and compose semantic items inside it:

```tsx
import {
  AgentActivity,
  AgentHumanInteraction,
  AgentPlan,
  AgentReasoning,
  AgentResult,
  AgentToolCall,
} from '@/packages/ui/components/ai-elements'

export function RunTranscript() {
  return (
    <AgentActivity>
      <AgentReasoning status="running" elapsedLabel="3s" summary="Inspecting the project shape." />
      <AgentPlan
        steps={[
          { id: '1', label: 'Read current UI primitives', status: 'complete' },
          { id: '2', label: 'Create shared AI elements', status: 'running' },
        ]}
      />
      <AgentToolCall toolName="read_file" status="complete" output={{ files: 4 }} />
      <AgentHumanInteraction description="Workspace write approval is required." />
      <AgentResult title="Generated UI primitives" />
    </AgentActivity>
  )
}
```

