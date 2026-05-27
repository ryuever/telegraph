import { describe, expect, it } from 'vitest'
import { runtimeMessagesForCurrentTurn } from '../runtimeMessages'

describe('runtimeMessagesForCurrentTurn', () => {
  it('appends the current turn when an older user message has the same content', () => {
    expect(runtimeMessagesForCurrentTurn({
      runId: 'run-repeat',
      message: 'again',
      messages: [
        { id: 'm-user-1', role: 'user', content: 'again' },
        { id: 'm-assistant-1', role: 'assistant', content: 'first answer' },
      ],
    })).toEqual([
      { id: 'm-user-1', role: 'user', content: 'again' },
      { id: 'm-assistant-1', role: 'assistant', content: 'first answer' },
      {
        id: 'run-repeat:user',
        role: 'user',
        content: 'again',
        metadata: {
          source: 'runtime-current-turn',
          runId: 'run-repeat',
        },
      },
    ])
  })
})
